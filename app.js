var express = require('express');
var path = require('path');
var favicon = require('serve-favicon');
var morgan = require('morgan');
var log4js = require('log4js');
var logger = log4js.getLogger();
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
var fs = require('fs');
var config = require('./config.json');
var session = require('express-session');
var passport = require('passport');
var Strategy = require('passport-twitter').Strategy;
var sqlite3 = require('sqlite3');
var crypto = require('crypto');
var sassMiddleware = require('node-sass-middleware');
var csurf = require('csurf')
var SQLiteStore = require('connect-sqlite3')(session);

function generateRandom() {
  var n = 16;
  var random;
  try {
    random = crypto.randomBytes(n*3/4);
  } catch (e) {
    logger.fatal("no entropy", e);
    process.exit(0);
  }
  return random.toString('base64');
}

//  passport
passport.use(new Strategy({
    consumerKey: config.TWITTER_CONSUMER_KEY,
    consumerSecret: config.TWITTER_CONSUMER_SECRET,
    callbackURL: config.URL + '/callback',
  },
  function (token, tokenSecret, profile, cb) {
    cb(null, profile);
  }));

passport.serializeUser(function(user, cb) {
  cb(null, user);
});

passport.deserializeUser(function(obj, cb) {
  cb(null, obj);
});

//  problem
var problemDir = config.PROBLEMS;
var problems = {};
var scoreThreshold = 0;   //  隠しフラグ以外を全て取ったときのスコア
try
{
  var index = JSON.parse(fs.readFileSync(problemDir+'index.json'));
  for (var i=0; i<index.length; i++)
  {
    var id = index[i];
    var problem = JSON.parse(fs.readFileSync(problemDir+id+'/problem.json'));
    problem.id = id;
    problem.statement = problem.statement.join('');
    problem.statement_hidden = problem.statement_hidden.join('');
    problems[id] = problem;

    for (var flag of problem.flags)
      if (!flag.hidden)
        scoreThreshold += flag.point;
  }
  logger.info('Loaded problems');
  for (var id in problems)
    logger.info('  '+id+': '+problems[id].title);
}
catch (e)
{
  logger.fatal('Failed to load problems', e.message);
  process.exit(0);
}

//  db
var db = new sqlite3.Database(path.join(__dirname, 'database.db'), sqlite3.OPEN_READWRITE, e => {
  if (e === null)
    logger.info("Database opend");
  else
  {
    logger.fatal('Failed to open database');
    process.exit(0);
  }
});

//  スコアの更新
function updateScore(user, callback)
{
  db.run('update user set ' +
    'score = (select ifnull(sum(point), 0) from problem, solved where ' +
      'solved.user = ? and ' +
      'problem.problem = solved.problem and ' +
      'problem.flag = solved.flag), '+
    'score_updated = (select ifnull(max(created_at), 0) from solved where user = ?) ' +
    'where id = ?',
    user, user, user, callback);
}

db.serialize(() => {
  db.run('delete from problem', err => {
    if (err != null) {
      logger.fatal('Failed to delete problem', err);
      process.exit(0);
    }
  });
  db.parallelize(() => {
    for (var problemId in problems) {
      var problem = problems[problemId];
      for (var i=0; i<problem.flags.length; i++) {
        db.run('insert into problem values(?,?,?)',
          problemId, problem.flags[i].id, problem.flags[i].point,
          err => {
            if (err != null) {
              logger.fatal('Failed to insert problem', err);
              process.exit(0);
            }
          });
      }
    }
  });
  db.each('select id from user', (err, row) => {
    if (err != null) {
      logger.fatal('Failed to find user', err);
      process.exit(0);
    }
    updateScore(row.id, err => {
      if (err != null) {
        logger.fatal('Failed to update user score', err);
        process.exit(0);
      }
    });
  });
  logger.info('Score udpated');
});

var app = express();

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');
app.set('strict routing', true);

// uncomment after placing your favicon in /public
app.use(favicon(path.join(__dirname, 'public', 'favicon.png')));
app.use(morgan('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(sassMiddleware({
  src: path.join(__dirname, 'public'),
  dest: path.join(__dirname, 'public'),
  indentedSyntax: true, // true = .sass and false = .scss
  sourceMap: true
}));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  store: new SQLiteStore({dir: __dirname}),
  secret: config.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 365*24*60*60*1000,
  },
}));
app.use(passport.initialize());
app.use(passport.session());
app.use(csurf());

function getUser(req, res, next)
{
  var id = req.session.userId;
  if (id == undefined)
    next();
  else
    db.get('select * from user where id=?', id, (err, row) => {
      if (err != null)
        logger.warn('Failed to find user', err, id);
      else if (row == undefined)
        logger.warn('Invalid user id', id);
      else {
        req.loginUser = row;
        req.loginUser.enableHidden = req.loginUser.score >= scoreThreshold;
        if (req.session.hidden == undefined)
          req.loginUser.hidden = req.loginUser.enableHidden;
        else
          req.loginUser.hidden = req.session.hidden
      }
      next();
    });
}
app.get('*', getUser);
app.post('*', getUser);

app.get('/', (req, res) => {
  res.render('index', {
    user: req.loginUser,
    csrfToken: req.csrfToken(),
  });
});

app.get('/problems/(:id/)?', (req, res, next) => {
  //  solved[problemId][flagId]に回答済みかどうかを持つ
  req.solved = {};

  if (req.loginUser == undefined) {
    next();
  } else {
    db.all('select * from solved where user=?', req.loginUser.id, (err, rows) => {
      if (err != null)
        logger.warn('Failed to find solved', err, id);
      else
        for (var row of rows) {
          if (!(row.problem in req.solved))
            req.solved[row.problem] = {}
          req.solved[row.problem][row.flag] = true;
        }
      next();
    });
  }
});

app.get('/problems/', (req, res) => {
  var number = {};
  db.all('select problem, flag, count(*) as number from solved group by problem, flag', (err, rows) => {
    if (err != null)
      logger.warn('Failed to get solve number', err);
    else {
      for (var row of rows) {
        if (!(row.problem in number))
          number[row.problem] = {};
        number[row.problem][row.flag] = row.number;
      }
    }
    var solver = {};
    //  たぶん遅いのでなんとかしたい
    var limit = 10;
    db.all(
      'select problem, flag, twitter_name, twitter_icon from solved as s1, user ' +
      '  where s1.user in ' +
      '    (select s2.user from solved as s2 ' +
      '      where s1.problem=s2.problem and s1.flag=s2.flag ' +
      '      order by created_at limit ?) and ' +
      '  s1.user=user.id',
      limit, (err, rows) => {
        if (err != null)
          logger.warn('Failed to get solve user', err);
        else {
          for (var row of rows) {
            if (!(row.problem in solver))
              solver[row.problem] = {};
            if (!(row.flag in solver[row.problem]))
              solver[row.problem][row.flag] = [];
            solver[row.problem][row.flag].push(row);
          }
        }
        res.render('problems', {
          user: req.loginUser,
          csrfToken: req.csrfToken(),
          problems: problems,
          solved: req.solved,
          number: number,
          solver: solver,
        });
      });
  });
});

app.get('/problems/:id/', (req, res, next) => {
  if (req.params.id in problems) {
    res.render('problem', {
      user: req.loginUser,
      csrfToken: req.csrfToken(),
      problem: problems[req.params.id],
      problems: problems,
      solved: req.solved,
    });
  } else
    next();
});

app.get('/problems/:id/:file', (req, res, next) => {
  var id = req.params.id;
  var file = req.params.file;
  if (id in problems &&
      (file == 'cover.png' || problems[id].files.indexOf(file)>=0))
    res.sendFile(id+'/'+file, {root: problemDir});
  else
    next();
});

app.post('/submit', (req, res) => {
  var user = req.loginUser;
  var userName = user != undefined ? (user.id+' '+user.twitter_name) : 'anonymous';
  var problemId = req.body.problem;
  var flag = req.body.flag.trim();

  logger.info('Flag submitted', userName, problemId, flag);

  if (problemId==undefined || flag==undefined)
    res.status(400).send();
  else if (!(problemId in problems))
    res.status(404).send();
  else {
    var sendResult = (result, point) => {
      logger.info('Flag submit result', result, userName, problemId, flag);
      res.contentType('application/json');
      res.send({
        result: result,
        point: point,
      });
    };

    var problem = problems[problemId];
    var flagId = '';
    var hidden = false;
    for (var i=0; i<problem.flags.length; i++)
      for (var j=0; j<problem.flags[i].flags.length; j++)
        if (problem.flags[i].flags[j]==flag) {
          flagId = problem.flags[i].id;
          point = problem.flags[i].point;
          hidden = problem.flags[i].hidden;
        }
    var result = '';

    if (flagId=='')
      sendResult('wrong', 0);
    else if (hidden && !(user && user.hidden))
      sendResult('hidden', 0);
    else if (user==undefined)
      sendResult('correct', point);
    else {
      db.get('select 1 from solved where user=? and problem=? and flag=?',
        user.id, problemId, flagId,
        (err, row) => {
          if (err != null) {
            logger.warn('Faild to find solved', err);
            res.status(500).send();
          } else if (row != undefined)
            sendResult('duplicate', 0);
          else {
            db.run('insert into solved values(?,?,?,?)',
              user.id, problemId, flagId, Date.now()/1000,
              err => {
                if (err != null) {
                  logger.warn('Faild to insert solved', err);
                  res.status(500).send();
                } else {
                  logger.info('Inserted into solved', userName, problemId, flagId);
                  updateScore(user.id, err => {
                    if (err != null) {
                      logger.warn('Failed to update score',
                        userName, problemId, FlagId, err);
                      res.status(500).send();
                    } else {
                      logger.info('Score updated', userName, problemId, flagId);
                      console.log(problem.flags, flagId);
                      sendResult('correct', point);
                    }
                  });
                }
              });
          }
        });
    }
  }
});

function formatDate(d) {
  var s = new Date((d+9*60*60)*1000).toISOString();
  return s.replace('T', ' ').replace('Z', '');
}

app.get('/ranking', (req, res) => {
  db.all('select * from user where score>0 order by score desc, score_updated',
    (err, rows) => {
    var users = [];
    if (err != null)
      logger.warn('Failed to get ranking', err);
    else
      users = rows;
    for (var u of users)
      u.score_updated = formatDate(u.score_updated);
    res.render('ranking', {
      user: req.loginUser,
      csrfToken: req.csrfToken(),
      users: users,
    });
  });
});

app.get('/log', (req, res) => {
  db.all('select *, solved.created_at as created_at from solved, user where ' +
    'solved.user = user.id ' +
    'order by solved.created_at desc', (err, rows) => {
    var solved = [];
    if (err != null)
      logger.warn('Failed to get log', err);
    else
      solved = rows;
    for (var s of solved) {
      s.point = 0;
      for (var f of problems[s.problem].flags)
        if (f.id == s.flag)
          s.point = f.point;
      s.problem = s.problem + ' - ' + problems[s.problem].title;
      s.created_at = formatDate(s.created_at);
    }
    res.render('log', {
      user: req.loginUser,
      csrfToken: req.csrfToken(),
      solved: solved,
    });
  });
});

app.get('/hidden', (req, res) => {
  res.render('hidden', {
    csrfToken: req.csrfToken(),
  });
});

app.post('/hidden', (req, res) => {
  if (req.loginUser.enableHidden ||
      req.body.key && req.body.key == config.HIDDEN_KEY)
    req.session.hidden = !req.session.hidden;
  res.redirect('/');
});

//  Twitterログイン
app.post('/login',
  passport.authenticate('twitter'));

app.get('/callback',
  passport.authenticate('twitter', {failureRedirect: '/'}),
  (req, res, next) => {
    var user = req.user;
    //  自前で管理するのでpassportのユーザー情報は破棄
    req.user = {};

    var current = Date.now()/1000;
    db.get('select id from user where twitter_id=?', user.id, (err, row) => {
      if (err != null) {
        logger.warn('Failed to find user', err);
        res.redirect('/');
      } else {
        if (row == undefined) {
          var id = generateRandom();
          db.run('insert into user values(?,?,?,?,?,?,?,?,?)',
            id, user.id, user.username, user.photos[0].value, null, 0, current, current, current,
            err => {
              if (err != null)
                logger.warn('Failed to add user', err, id, user);
              else {
                logger.info('Created user', id, user.id, user.username);
                req.session.userId = id;
              }
              res.redirect('/');
            });
        } else {
          var id = row.id;
          db.run('update user set twitter_name=?, twitter_icon=?, updated_at=? where id=?',
            user.username, user.photos[0].value, current, id,
            err => {
              if (err != null)
                logger.warn('Failed to update user', err, id, user);
              else {
                logger.info('User logined', id, user.id, user.username);
                req.session.userId = id;
              }
              res.redirect('/');
            });
        }
      }
    });
});

app.post('/logout', (req, res) => {
  var user = req.loginUser;
  logger.info('User logouted', user.id, user.twitter_name);
  req.session.destroy();
  res.redirect('/');
});

// catch 404 and forward to error handler
app.use((req, res, next) => {
  var err = new Error('Not Found');
  err.status = 404;
  next(err);
});

// error handler
app.use((err, req, res, next) => {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

module.exports = app;
