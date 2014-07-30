var PPWorker = require('../index');

function workerFn(cb) {
  return cb(JSON.stringify({ppworker: 'pretending to do work'}));
}

var ppw = new PPWorker({url: 'tcp://127.0.0.1:9001'}, workerFn)
  .on('work', function (message) {
    // this event is emitting for debug/tracing purposes, it's not the worker function!
    console.log(Date.now() + ' - Sent work to client via queue:', message.toString('utf8'));
  });
