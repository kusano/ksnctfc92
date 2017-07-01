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
var problemDir = './problems/';
var problems = {};
try
{
  var index = JSON.parse(fs.readFileSync(problemDir+'index.json'));
  for (var i=0; i<index.length; i++)
  {
    var id = index[i];
    var problem = JSON.parse(fs.readFileSync(problemDir+id+'/problem.json'));
    problem.id = id;
    problem.statement = problem.statement.join('');
    problems[id] = problem;
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
var db = new sqlite3.Database('database.db', sqlite3.OPEN_READWRITE, e => {
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
    'score = (select sum(point) from problem, solved where ' +
      'solved.user = ? and ' +
      'problem.problem = solved.problem and ' +
      'problem.flag = solved.flag), '+
    'score_updated = (select max(created_at) from solved where user = ?);',
    user, user, callback);
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

// uncomment after placing your favicon in /public
//app.use(favicon(path.join(__dirname, 'public', 'favicon.ico')));
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
  secret: config.SESSION_SECRET,
  resave: false,
  saveUninitialized: false
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
      else
        req.loginUser = row;
      next();
    });
}
app.get('*', getUser);
app.post('*', getUser);

app.get('/', (req, res) => {
  res.render('index', {
    user: req.loginUser,
    csrfToken: req.csrfToken(),
    problems: problems,
  });
});

app.get('/problems/:id/', (req, res, next) => {
  if (req.params.id in problems) {
    res.render('problem', {
      csrfToken: req.csrfToken(),
      problem: problems[req.params.id]
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
    var sendResult = (result) => {
      logger.info('Flag submit result', result, userName, problemId, flag);
      res.contentType('text/plain');
      res.send(result);
    };

    var problem = problems[problemId];
    var flagId = '';
    for (var i=0; i<problem.flags.length; i++)
      for (var j=0; j<problem.flags[i].flags.length; j++)
        if (problem.flags[i].flags[j]==flag)
          flagId = problem.flags[i].id;
    var result = '';

    if (flagId=='')
      sendResult('wrong');
    else if (user==undefined)
      sendResult('correct');
    else {
      db.get('select 1 from solved where user=? and problem=? and flag=?',
        user.id, problemId, flagId,
        (err, row) => {
          if (err != null) {
            logger.warn('Faild to find solved', err);
            res.status(500).send();
          } else if (row != undefined)
            sendResult('duplicate');
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
                      sendResult('correct');
                    }
                  });
                }
              });
          }
        });
    }
  }
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
