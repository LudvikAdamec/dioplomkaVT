'use strict';
require('../bower_components/closure-library/closure/goog/bootstrap/nodejs');
goog.require('goog.array');
goog.require('goog.string');  

var memwatch = require('memwatch-next');

memwatch.on('leak', function(info) {
  console.log(info)
});

var topojson = require("topojson");

var convertGeoToTopo = function (feature_collection) {
  //var topology = topojson.topology({collection: feature_collection, propertyTransform: function propertyTransform(feature) {return feature.properties;}});
  var topology = topojson.topology({collection: feature_collection},{"property-transform":function(object){return object.properties;}});

  return topology;
};



var statistics = require('./statistics.js');

if(true == true){
  
    //console.log(statistics.loadDatabaseDocs('topojson_no_cache_1'));    
    //console.log(statistics.loadDatabaseDocs('topojson_cache_1')); 
    //console.log(statistics.loadDatabaseDocs('vt_geo_cache_1')); 
}

//memwatch.on('stats', function(stats) {console.log(stats)});

var pg = require('pg'),
  grunt = require('grunt'),
  express = require('express'),
  app = express(),
  fs = require("fs"),
  plovrVars = require('./../tasks/util/get-plovr-vars.js'),
  plovrIds = plovrVars.plovrIds,
  bodyParser = require('body-parser')


app.use('/client/src/', function(req, res, next) {
  var filePath = req.path;
  if(goog.string.endsWith(filePath, '/')) {
    filePath = filePath + 'index.html';
  }
  filePath = 'client/src' + filePath;
  if(goog.string.endsWith(filePath, '.html') && fs.existsSync(filePath)) {
    var cnt = fs.readFileSync(filePath);
    cnt += "";
    cnt = cnt.replace(/^(.*<link.* href=['"])([^'"]+)(['"].*\/(link)?>.*$)/gmi,
        function(match, prePath, path, postPath) {
          // CSS
          if(path.indexOf('http://localhost:9810/css/')===0) {
            var plovrId = path.substring(26, path.length-1);
            if(goog.string.caseInsensitiveEndsWith(plovrId, '-debug')) {
              plovrId = plovrId.substring(0, plovrId.length-6);
            }
            var plovrConfig = grunt.file.readJSON(plovrIds[plovrId]);
            var srcCssFiles = plovrConfig['css-inputs'];
            var result = srcCssFiles.join(postPath + "\n" + prePath);
            result = prePath + result + postPath;
          } else {
            result = match;
          }
          return result;
        });
    
    res.set('Content-Type', 'text/html');
    res.send(cnt);
  } else {
    next();
  }
});

app.use(
    "/compile", //the URL throught which you want to access to you static content
    express.static('client/public') //where your static content is located in your filesystem
);

/*
app.get('/', function(req, res) {
    res.sendfile(__dirname + '../client/public/index.html')
    //res.sendFile('/client/public/index.html');
});
*/

/******************************** SPATIAL INDEXING ROUTING ****************************************/
// Clients initialization
var getFeaturesByIdClient = undefined;
var connectionString = " postgresql://$OPENSHIFT_POSTGRESQL_DB_HOST:$OPENSHIFT_POSTGRESQL_DB_PORT/" + 'vfr_instalace2';
connectionString = "postgres://postgres:postgres@localhost/" + 'vfr_instalace2';

pg.connect(connectionString, function(err, client, done) {
    if (err) {
      console.log('err2', err);
    }
  getFeaturesByIdClient = client;
});

var getFeaturesIdInBboxClient = undefined;
var featuresIdDone = undefined;
pg.connect(connectionString, function(err, client, done) {
  if (err) {
    console.log('Error v pool conn: ', err);
  }

  getFeaturesIdInBboxClient = client;
  featuresIdDone = done;
});

var clientGetGeom = undefined;
pg.connect(connectionString, function(err, client, done) {
  if (err) {
    console.log('err2', err);
  }
  clientGetGeom = client;
});


var clipFactor = 2;
var getFeaturesIdInBbox  = require('./get-features-id-in-bbox.js');
app.get('/getFeaturesIdInBbox', function(req, res){
  new getFeaturesIdInBbox(req, res, undefined, undefined, clipFactor);
  //new getFeaturesIdInBbox(req, res, getFeaturesIdInBboxClient, featuresIdDone);
});

var getGeometryInLayers = require('./get-geometry-in-layers.js');
app.get('/getGeometryInLayers', function(req, res){
  new getGeometryInLayers(req, res, undefined, clipFactor);
  //new getGeometryInLayers(req, res, clientGetGeom);
});

var getFeaturesById = require('./get-features-by-id.js');
app.get('/getFeaturesByIdinLayers', function(req, res){
  new getFeaturesById(req, res);
  //new getFeaturesById(req, res, getFeaturesByIdClient);
});

/**************************************************************************************************/






/******************************** VECTOR TILE ROUTING *********************************************/
var renderTileClient = undefined;
pg.connect(connectionString, function(err, client, done) {
    if (err) {
      console.log('Error v pool conn: ', err);
    }

  renderTileClient = client;
});


/*
 * Request example: http://localhost:9001/se/renderTile?x=1&y=2&z=3
 */
var renderTile = require('./render-tile.js');
app.get('/se/renderTile', function(req, res){
  new renderTile(req, res, false);
  //new renderTile(req, res, false, renderTileClient);
});

/*
 * Request example: http://localhost:9001/se/renderTile?x=1&y=2&z=3
 */
app.get('/se/topojsonTile', function(req, res){
  new renderTile(req, res, true);
});
/**************************************************************************************************/

var automatizeSIMeasuring = false;
var measure_to_db = ['si_2x_4', 'si_4x_4', 'si_8x_4', 'si_80000x_4', 'si_001x_4'];
var measure_to_db = ['throttling_mereni', 'throttling_mereni', 'throttling_mereni', 'throttling_mereni', 'throttling_mereni'];
var factors = [2, 4, 8, 80000, 0.01];

var saveStatToDBCounter = 0;

var currentMeasureIndex = 0;


/******************************** STATISTICS SAVING ***********************************************/
var nano = require('nano')('http://localhost:5984');
app.post('/saveStatToDB', bodyParser.json(), function (req, res) {
  
  if (!req.body) return res.status(400).end();
  //var results_db = nano.db.use('topojson_measure_node_cache');
  var dbName = dbName = req.param('dbName');
  
  if(!dbName){
      dbName = 'geojson_measure_node_cache_pool';
  }

  //dbName = 'results_si_no_pool12';
  //dbName = 'vt_4';
  //dbName = 'topojson_no_cache_1';
  //dbName = 'vt_geo_cache_1';
  
  if(automatizeSIMeasuring){
      dbName = measure_to_db[currentMeasureIndex]
  }
  
  dbName = 'tets';
  console.log(req.body);

  var results_db = nano.db.use(dbName);

  results_db.insert(req.body, function(err, body){
    if(err){
        console.log("errorr: ", err);
      return res.status(500).end();
    } else {
        console.log("ok saved" );
      return res.status(200).end();
    }
  });
  
  if(automatizeSIMeasuring){
      saveStatToDBCounter++;
  }
  
   if(saveStatToDBCounter > 1 && automatizeSIMeasuring){    
      currentMeasureIndex++;
      saveStatToDBCounter = 0;
      clipFactor = factors[currentMeasureIndex];
  } 
  
});
/**************************************************************************************************/



app.use('/', express.static(__dirname+'/../'));
app.use('/public', express.static(__dirname + '../public/'));


var server_port = process.env.OPENSHIFT_NODEJS_PORT || 9001
var server_ip_address = process.env.OPENSHIFT_NODEJS_IP || '127.0.0.1'
 
/*app.listen(server_port, server_ip_address, function () {
  console.log( "Listening on " + server_ip_address + ", server_port " + server_port )
});*/


app.listen(9001, function() {
  console.log("Server is up");
});

