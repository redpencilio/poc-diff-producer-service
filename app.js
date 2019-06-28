// see https://github.com/mu-semtech/mu-javascript-template for more info

import { app, query, errorHandler } from 'mu';
import fs from 'fs';
import bodyParser from 'body-parser';

app.use( bodyParser.json( { type: function(req) { return /^application\/json/.test( req.get('content-type') ); } } ) );

const DELTA_INTERVAL = 1000;

let cache = [];
let hasTimeout = null;

app.post('/delta', function( req, res ) {
  const body = req.body;

  console.log(`Pushing onto cache ${JSON.stringify(body)}`);

  cache.push( ...body );

  if( !hasTimeout ){
    triggerTimeout();
  }

  res.status(200).send("Processed");
} );


function triggerTimeout(){
  setTimeout( generateDeltaFile, DELTA_INTERVAL );
  hasTimeout = true;

}

function generateDeltaFile(){
  const cachedArray = cache;
  cache = [];

  hasTimeout = false;

  fs.writeFile(`/data/delta-${new Date().toISOString()}`, JSON.stringify( cachedArray ), function(err) {
    if(err) {
      return console.log(err);
    }

    console.log("The file was saved!");
    return null;
  });
}
