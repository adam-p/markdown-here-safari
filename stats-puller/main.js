/*
 * Copyright Adam Pritchard 2014
 * MIT License : http://adampritchard.mit-license.org/
 */

/* jslint node: true */
"use strict";


var fs = require('fs');
var AWS = require('aws-sdk');
var Promise = require('bluebird');

var conf = JSON.parse(fs.readFileSync('./conf.json'));
AWS.config.update({ 'accessKeyId': conf['awsAccessID'], 'secretAccessKey': conf['awsSecretKey'] });

var s3 = new AWS.S3();
var listBucketObjects = Promise.promisify(s3.listObjects, s3);
var getBucketObject = Promise.promisify(s3.getObject, s3);
var headBucketObject = Promise.promisify(s3.headObject, s3);
var deleteBucketObject = Promise.promisify(s3.deleteObject, s3);

var stats = JSON.parse(fs.readFileSync('./stats.json'));

var promise = headBucketObject({Bucket: conf['extBucket'], Key: conf['extKey']});
promise.then(function(obj) {
  var releaseDate = new Date(obj.LastModified).toISOString();
  if (releaseDate > stats.latestRelease) {
    stats.latestRelease = releaseDate;
    stats.count = 0;
  }
});

promise = promise.then(function() {
  return processBucketBatch(stats.lastKey);
});

promise.then(function() {
  fs.writeFileSync('./stats.json', JSON.stringify(stats));
  console.log(stats);
});

promise.catch(function(e) {
  console.log('Error!', e);
});

promise.finally(function() {
  console.log('All done');
});

// Processes a batch of objects ("batch" := the number of objects S3 returns
// from `listObjects`). Returns a promise that is fulfilled when it's done.
function processBucketBatch(marker) {
  var resolver = Promise.pending();

  var params = { Bucket: conf['logBucket'], MaxKeys: 10 };
  if (marker) {
    params.Marker = marker;
  }

  console.log('Requesting bucket objects from marker: ' + String(marker));

  listBucketObjects(params).then(function(listBucketObjectsData) {
    console.log('Got ' + listBucketObjectsData.Contents.length + ' objects');

    var i, objectProcessors = [], lastKey = null;
    for (i = 0; i < listBucketObjectsData.Contents.length; i++) {
      objectProcessors.push(processObject(listBucketObjectsData.Contents[i]));
      lastKey = listBucketObjectsData.Contents[i].Key;
    }

    Promise.all(objectProcessors).then(function() {
      stats.lastKey = lastKey || stats.lastKey;

      // Write stats as we go.
      fs.writeFileSync('./stats.json', JSON.stringify(stats));

      if (listBucketObjectsData.IsTruncated && lastKey) {
        // Recursive call to continue processing
        processBucketBatch(lastKey).then(
          function() { resolver.fulfill(); },
          function(e) { resolver.reject(e); });
      }
      else {
        // All done
        resolver.fulfill();
      }
    }).catch(function(e) { resolver.reject(e); });
  }).catch(function(e) { resolver.reject(e); });

  return resolver.promise;
}


// Returns a promise that is fulfilled with the number of valid downloads.
function processObject(object) {
  var resolver = Promise.pending();

  // Is this item too old?
  // Note that it's not entirely accurate to use the object's `LastModified`
  // rather than get and parse the log. But close enough.
  if (new Date(object.LastModified).toISOString() < stats.latestRelease) {
    return Promise.fulfilled();
  }

  getBucketObject({Bucket: conf['logBucket'], Key: object.Key}).then(function(data) {
    data.Body.toString().split('\n').forEach(function(log) {
      var match = log.match(/^(\w+) ([^\s]+) \[([^\]]+)\] ([^\s]+) ([^\s]+) ([^\s]+) ([^\s]+) ([^\s]+) "([^\s]+) ([^\s]+) ([^\s]+)" ([^\s]+) ([^\s]+) ([^\s]+) ([^\s]+)/);
      if (match &&
          match[9] === 'GET' &&
          match[10] === '/' + conf['extKey'] &&
          match[12] === '200' &&
          match[14] === match[15]) {
        // Good match
        stats.count += 1;
        console.log(log);
      }
    });

    resolver.fulfill();
  },
  function(e) {
    resolver.reject(e);
  });

  return resolver.promise;
}
