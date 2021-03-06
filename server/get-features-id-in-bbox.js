// Located in: ./get-features-id-in-bbox.js
var nano = require('nano')('http://localhost:5984');
var pg = require('pg');

var getFeaturesIdInBbox = function(req, res, client, done, clipingFactor){
  var this_ = this;
  this.req = req;
  this.res = res;
  this.clipingFactor = clipingFactor;
  
  this.extent = req.param('extent');
  this.layers = req.param('layers');
  this.dbName = req.param('db');
  this.geomRow = req.param('geom');
  this.idColumn = req.param('idColumn');
  this.clipBig = req.param('clipBig');

  this.extentConverted = this.extent.map(function (x) {
    return parseFloat(x, 10);
  });

  this.envelop =  'ST_MakeEnvelope(' + 
                    this.extentConverted[0] + ', ' + 
                    this.extentConverted[1] + ', ' + 
                    this.extentConverted[2] + ', ' + 
                    this.extentConverted[3] + ', 4326)';

  this.results = {};
  this.existCountRequests;

  this.existRowCache = {};
  
  var connectionString = "postgres://postgres:postgres@localhost/" + this.dbName;

  if(client) {
    this.client = client;
    this.done = done;
    this.sharedPool = true;
    this.init();
  } else {
    this.sharedPool = false;
    pg.connect(connectionString, function(err, client, done) {
      if (err) {
        console.log('err2', err);
      }

      this_.client = client;
      this_.done = done;
      this_.init();
    });
  }  
};

getFeaturesIdInBbox.prototype.init = function(){
    this.existCountRequests = this.layers.length;
    for (var i = 0; i < this.layers.length; i++) {
      var layerName = this.layers[i];
      this.results[this.layers[i]] = {};
      //console.log("befc");
      this.existRowInDB(layerName);
    }
};

getFeaturesIdInBbox.prototype.callback = function(){
    this.existCountRequests--;
    if(this.existCountRequests == 0){
      this.res.json({ "layers" : this.results, "extent": this.extent, "level": this.req.param('level') });
      if(!this.sharedPool){
        this.done();
      }
    }
};

getFeaturesIdInBbox.prototype.existRowCallback = function(exist, layerName){
  var this_ = this;

  var queryString;
  if(exist){
      
          //console.log("clipingFactor", this.clipingFactor);

      if(this.clipBig == "true"){
          
        var extentArea = (this.extentConverted[2] - this.extentConverted[0]) * (this.extentConverted[3] - this.extentConverted[1]);
        /*
        console.log("extent", this.extentConverted);
        console.log('-----------------------');
        console.log('extentArea:', extentArea);
        console.log('2x:', extentArea * 2);
        console.log('4x:', extentArea * 4);
        console.log('8x:', extentArea * 8);
        */
        
        //todo: predelat efektivne na intersects
        queryString = ' SELECT ' + this.idColumn + ', ' +
         ' CASE   WHEN area > ' + (extentArea * this.clipingFactor) + ' THEN 1 ELSE 0 END AS needclip ' +
         ' FROM ' + layerName + 
         ' WHERE ' + layerName + '.' + this.geomRow + '&&' + this.envelop  ;

      } else {
        queryString = "" +
          ' SELECT ' + this.idColumn +
          ' FROM ' + layerName + 
          ' WHERE ' + layerName + '.' + this.geomRow + '&&' + this.envelop ;
      }
      
      //console.log(queryString);
      
      var query = this.client.query(queryString, function(err, content){
        if(err){
          console.log('err', err);
        }
      });
      
      query.on('row', function(row) {
        if(this_.clipBig == "true"){
          this_.results[layerName][row[this_.idColumn]] = row['needclip'];
        } else {
          this_.results[layerName][row[this_.idColumn]] = false;
        }
      });
      
      query.on('end', function() {
          this_.callback();          
      });

    } else {
      this_.callback();
    }
};

getFeaturesIdInBbox.prototype.existRowInDB = function(layerName) {   
  var this_ = this;

  if (this.existRowCache[layerName]) {
    if (this.existRowCache[layerName][this.geomRow] != undefined) {
      if (this.existRowCache[layerName][this.geomRow] == true) {
        this.existRowCallback(true, layerName);
        return;
      } else {
        this.existRowCallback(false);
        return;
      }
    }
  } else {
    this.existRowCache[layerName] = {};
  }

  var query = this.client.query('SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND column_name = $2', [layerName, this.geomRow], function(err, result) {
    if(err){
      console.log('err4', err);
    }

    if (result.rowCount > 0) {
      this_.existRowCache[layerName][this.geomRow] = true;
      this_.existRowCallback(true, layerName);
    } else {
      this_.existRowCache[layerName][this.geomRow] = false;
      this_.existRowCallback(false);
    }
  });

  query.on('end', function() {
    this_.existRowInDBCount--;
    //this_.done();
  });
};


module.exports = getFeaturesIdInBbox;

