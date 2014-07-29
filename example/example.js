var PPWorker = require('../index');

function workerFn(cb) {
  console.log(Date.now() + ' - Got a request for work');
  return cb(JSON.stringify({pretending: 'to do work'}));
}

var ppw = new PPWorker({url: 'tcp://127.0.0.1:9001'}, workerFn);
