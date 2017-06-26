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
    callbackURL: config.URL + '/twitter/callback',
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
var problems = {};
try
{
  var index = JSON.parse(fs.readFileSync('./problems/index.json'));
  for (var i=0; i<index.length; i++)
  {
    var id = index[i];
    var problem = JSON.parse(fs.readFileSync('./problems/'+id+'/problem.json'));
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
    logger.info("Opened database");
  else
  {
    logger.fatal('Failed to open database');
    process.exit(0);
  }
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
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: config.SESSION_SECRET,
  resave: false,
  saveUninitialized: false
}));
app.use(passport.initialize());
app.use(passport.session());

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

app.get('/', function(req, res, next) {
  res.render('index', {
    title: 'Express',
    user: req.loginUser,
    problems: problems,
  });
});

app.get('/problems/:id', function(req, res, next) {
  if (req.params.id in problems) {
    res.render('problem', {
      problem: problems[req.params.id]
    });
  } else {
    next();
  }
});

//  Twitterログイン
app.get('/twitter/login',
  passport.authenticate('twitter'));
app.get('/twitter/callback',
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
          db.run('insert into user values(?,?,?,?,?,?,?,?)',
            id, user.id, user.username, user.photos[0].value, 0, true, current, current,
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

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  var err = new Error('Not Found');
  err.status = 404;
  next(err);
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

module.exports = app;
