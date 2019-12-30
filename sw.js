/* global self ReadableStream Response */

const downloadMap = new Map()
var fileDataTuple
var webViewerPrefix = "/sandbox/";
// This should be called once per download
// Each event has a dataChannel that the data will be piped through
self.onmessage = event => {
  // We send a heartbeat every x secound to keep the
  // service worker alive
  if (event.data === 'ping') {
    return
  }

  // Create a uniq link for the download
  const uniqLink = self.registration.scope + 'intercept-me-nr' + Math.random()
  const port = event.ports[0]

  var filename = event.data.filename
  var headers
  if (filename.startsWith("web-viewer")) {
        let fileData = new FileData();
        setupStreamingFileData(port, fileData)
        fileDataTuple = [fileData, port]
  } 
  port.postMessage({ download: uniqLink, ping: self.registration.scope + 'ping' })

  // Mistage adding this and have streamsaver.js rely on it
  // depricated as from 0.2.1
  port.postMessage({ debug: 'Mocking a download request' })
}

function FileData() {
     this.fileMap = new Map()

    this.isComplete = function() {
        return this.complete
    }
    this.setComplete = function() {
        this.complete = true
    }
    this.getFile = function(fullPath) {
        return this.fileMap.get(fullPath)
    }
    //currently assume each resource fits in 1 chunk
    //header consists of  filePathSize (1 byte), filePath
    this.enqueue = function(moreData) {
        let filePathSize = moreData[0];
        let filePathBytes = moreData.subarray(1, filePathSize + 1);
        let filePath = new TextDecoder().decode(filePathBytes);

        var file = this.fileMap.get(filePath)
        if(file == null) {
            file = new Uint8Array(0);
        }
        const combinedSize = file.byteLength + moreData.byteLength - filePathSize;
        var newFile = new Uint8Array(combinedSize);
        newFile.set(file);
        newFile.set(moreData.subarray(filePathSize + 1), file.byteLength);
        this.fileMap = new Map();
        this.fileMap.set(filePath, newFile);
    }
}
function setupStreamingFileData(port, fileData) {
    port.onmessage = ({ data }) => {
        if (data != 'end' && data != 'abort') {
            if (data.byteLength == 0) {
                fileData.setComplete()
            } else {
                fileData.enqueue(data)
            }
        }
    }
}

self.addEventListener('install', event =>  {
    self.skipWaiting();
});
self.addEventListener('activate', event => {
    clients.claim();
});

self.onfetch = event => {
    const url = event.request.url
    console.log("url=" + url);
    if (url.endsWith('/ping')) {
      return event.respondWith(new Response('pong', {
        headers: { 'Access-Control-Allow-Origin': '*' }
      }))
    }
    const requestedResource = new URL(event.request.url)
    if (requestedResource.pathname.startsWith(webViewerPrefix)) {
            var filePath = requestedResource.pathname.substring(webViewerPrefix.length);
            console.log("sw filePath=" + filePath);
            const [fileData, port] = fileDataTuple
            port.postMessage({ filePath: filePath })
            return event.respondWith(returnFileData(fileData, filePath))
    } else {
		return;
    }
}

function returnFileData(fileData, filePath) {
    return new Promise(function(resolve, reject) {
        let pump = () => {
            let file = fileData.getFile(filePath)
            if (file == null || file.byteLength == 0) {
                setTimeout(pump, 500)
            } else {
                resolve(file);
            }
        }
        pump()
    }).then(function(arrayBuffer, err) {
            return new Response(arrayBuffer, {
              status: 200,
              headers: [
                ['content-length', arrayBuffer.byteLength]
              ]
            });
    });
}

