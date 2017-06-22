var express = require('express');
var path = require('path');
var favicon = require('serve-favicon');
var morgan = require('morgan');
var log4js = require('log4js');
var logger = log4js.getLogger();
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
var fs = require('fs');

var problems = {};
try
{
  var index = JSON.parse(fs.readFileSync('./problems/index.json'));
  for (var i=0; i<index.length; i++)
  {
    var id = index[i];
    var problem = JSON.parse(fs.readFileSync('./problems/'+id+'/problem.json'));
    problems[id] = problem;
  }
  logger.info('Loaded problems');
  for (var id in problems)
    logger.info('  '+id+': '+problems[id].title);
}
catch (e)
{
  logger.fatal("Failed to load problems", e.message);
  process.exit(0);
}

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

app.get('/', function(req, res, next) {
  res.render('index', { title: 'Express' });
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
