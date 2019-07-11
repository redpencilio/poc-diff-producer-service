// see https://github.com/mu-semtech/mu-javascript-template for more info
import { app, errorHandler, uuid, sparqlEscapeDate } from 'mu';
import { querySudo as query, updateSudo as update } from '@lblod/mu-auth-sudo';
import fs from 'fs-extra';
import bodyParser from 'body-parser';

app.use( bodyParser.json( { type: function(req) { return /^application\/json/.test( req.get('content-type') ); } } ) );

const DELTA_INTERVAL = process.env.DELTA_INTERVAL_MS || 1000;
const shareFolder = '/share';

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

async function generateDeltaFile(){
  const cachedArray = cache;
  cache = [];

  hasTimeout = false;

  try {
    const filename = `delta-${new Date().toISOString()}.json`;
    const filepath = `/${shareFolder}/${filename}`;
    await fs.writeFile(filepath, JSON.stringify( cachedArray ));
    console.log("The file was saved on disk!");
    await writeFileToStore(filename, filepath);
    console.log("The file was saved in the store!");
  } catch (e) {
    console.log(e);
  }
}

async function writeFileToStore(filename, filepath) {
  const virtualFileUuid = uuid();
  const virtualFileUri = `http://mu.semte.ch/services/poc-diff-producer-service/files/${virtualFileUuid}`;
  const now = new Date();
  const physicalFileUuid = uuid();
  const physicalFileUri = `share://${filename}`;

  await update(`
    PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
    PREFIX nfo: <http://www.semanticdesktop.org/ontologies/2007/03/22/nfo#>
    PREFIX nie: <http://www.semanticdesktop.org/ontologies/2007/01/19/nie#>
    PREFIX dbpedia: <http://dbpedia.org/resource/>
    PREFIX dct: <http://purl.org/dc/terms/>

    INSERT DATA {
      GRAPH <http://mu.semte.ch/graphs/public> {
        <${virtualFileUri}> a nfo:FileDataObject ;
          mu:uuid "${virtualFileUuid}" ;
          nfo:fileName "${filename}" ;
          dct:format "application/json" ;
          dbpedia:fileExtension "json" ;
          dct:created ${sparqlEscapeDate(now)} ;
          dct:modified ${sparqlEscapeDate(now)} ;
          dct:publisher <http://mu.semte.ch/services/oc-diff-producer-service> .
        <${physicalFileUri}> a nfo:FileDataObject ;
          mu:uuid "${physicalFileUuid}" ;
          nie:dataSource <${virtualFileUri}> ;
          nfo:fileName "${filename}" ;
          dct:format "application/json" ;
          dbpedia:fileExtension "json" ;
          dct:created ${sparqlEscapeDate(now)} ;
          dct:modified ${sparqlEscapeDate(now)} .
      }
    }
  `);
}
