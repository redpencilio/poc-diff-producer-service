// see https://github.com/mu-semtech/mu-javascript-template for more info
import { app, errorHandler, uuid, sparqlEscapeDateTime } from 'mu';
import { querySudo as query, updateSudo as update } from '@lblod/mu-auth-sudo';
import fs from 'fs-extra';
import bodyParser from 'body-parser';

app.use( bodyParser.json( { type: function(req) { return /^application\/json/.test( req.get('content-type') ); } } ) );

const DELTA_INTERVAL = process.env.DELTA_INTERVAL_MS || 1000;
//const CACHE_SIZE = process.env.CACHE_SIZE || 1000;
const shareFolder = '/share';

let cache = [];
let minDelta = 0; // Highest delta number which has been written to a file
let hasTimeout = false;

app.post('/delta', function( req, res ) {
  const body = req.body;

  console.log(`Pushing onto cache ${JSON.stringify(body)}`);

  for(const delta of body) {
    // If the index is less than what we've already put out, we consider it lost
    // TODO: Keep a longer cache, including already-pushed deltas, to issue corrections
    if(delta.index < minDelta) {
      continue;
    }

    // Either insert at the end, or splice in earlier if needed
    if(cache.length == 0 || delta.index > cache[cache.length-1].index) {
      cache.push( delta );
    } else {
      let i = cache.length-1;
      while(cache[i].index > delta.index) {
        i = i - 1;
      }
      cache.splice(i, 0, delta );
    }
  }

  //if(cache.length > CACHE_SIZE) {
  //  cache.shift();
  //}

  if( !hasTimeout ){
    triggerTimeout();
  }

  res.status(200).send("Processed");
} );

app.get('/files', async function( req, res ) {
  const since = req.query.since || new Date().toISOString();
  console.log(`Retrieving delta files since ${since}`);

  const result = await query(`
    PREFIX mu: <http://mu.semte.ch/vocabularies/core/>
    PREFIX nfo: <http://www.semanticdesktop.org/ontologies/2007/03/22/nfo#>
    PREFIX nie: <http://www.semanticdesktop.org/ontologies/2007/01/19/nie#>
    PREFIX dct: <http://purl.org/dc/terms/>

    SELECT ?uuid ?filename ?created WHERE {
      ?s a nfo:FileDataObject ;
          mu:uuid ?uuid ;
          nfo:fileName ?filename ;
          dct:publisher <http://mu.semte.ch/services/poc-diff-producer-service> ;
          dct:created ?created .
      ?file nie:dataSource ?s .

      FILTER (?created > "${since}"^^xsd:dateTime)
    } ORDER BY ?created
  `);

  const files = result.results.bindings.map(b => {
    return {
      type: 'files',
      id: b['uuid'].value,
      attributes: {
        name: b['filename'].value,
        created: b['created'].value
      }
    };
  });

  res.json({ data: files });
} );

function triggerTimeout(){
  setTimeout( generateDeltaFile, DELTA_INTERVAL );
  hasTimeout = true;
}

async function generateDeltaFile() {
  const cachedArray = cache;
  cache = [];
  minDelta = cachedArray[cachedArray.length-1].index;

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
  const nowLiteral = sparqlEscapeDateTime(new Date());
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
          dct:created ${nowLiteral} ;
          dct:modified ${nowLiteral} ;
          dct:publisher <http://mu.semte.ch/services/poc-diff-producer-service> .
        <${physicalFileUri}> a nfo:FileDataObject ;
          mu:uuid "${physicalFileUuid}" ;
          nie:dataSource <${virtualFileUri}> ;
          nfo:fileName "${filename}" ;
          dct:format "application/json" ;
          dbpedia:fileExtension "json" ;
          dct:created ${nowLiteral} ;
          dct:modified ${nowLiteral} .
      }
    }
  `);
}
