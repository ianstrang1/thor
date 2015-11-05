'use strict';

var Socket = require('ws')
  , connections = {};

//
// Get the session document that is used to generate the data.
//
var session = require(process.argv[2]);

//
// WebSocket connection details.
//
var masked = process.argv[4] === 'true'
  , binary = process.argv[5] === 'true'
  , protocol = +process.argv[3] || 13;

// 收集后一次性send给master
var metrics_datas = {collection:true, datas:[]};

process.on('message', function message(task) {
  var now = Date.now();

  //
  // Write a new message to the socket. The message should have a size of x
  //
  if ('write' in task) {
    Object.keys(connections).forEach(function write(id) {
      write(connections[id], task, id);
    });
  }

  //
  // Shut down every single socket.
  //
  if (task.shutdown) {
    Object.keys(connections).forEach(function shutdown(id) {
      connections[id].close();
    });
  }

  // End of the line, we are gonna start generating new connections.
  if (!task.url) return;

  var sock_opts = {
    protocolVersion: protocol
  };

  if (task.localaddr) {
    sock_opts.localAddress = task.localaddr;
  };
  var socket = new Socket(task.url, sock_opts);
  socket.last = Date.now();
  var inteval = null;

  socket.on('open', function open() {
    var send_data = { type: 'open', duration: Date.now() - now, id: task.id };
    // process.send(send_data);
    metrics_datas.datas.push(send_data);
    // write(socket, task, task.id);
    // 
    if (task.send_opened) {
      process.send({ type: 'opened', duration: Date.now() - now, id: task.id });
    };

    inteval = setInterval(function ping(id, socket) {
      if(socket && (typeof socket.ping == 'function')) {
        socket.ping();
      }else{
        clearInterval(inteval);
      }
    }, 25000, task.id, socket);
    // As the `close` event is fired after the internal `_socket` is cleaned up
    // we need to do some hacky shit in order to tack the bytes send.
    // 
    // process.send({ type: 'showopened', opened: Object.keys(connections).length });
  });

  socket.on('message', function message(data) {
    var send_data = {
      type: 'message', latency: Date.now() - socket.last,
      id: task.id
    };
    // process.send(send_data);
    metrics_datas.datas.push(send_data);

    console.log('['+task.id.substr(task.id.indexOf('::'))+']socket on message@'+socket.last, "\n", data, "\n");
    // Only write as long as we are allowed to send messages
    if (--task.messages && task.messages > 0) {
      write(socket, task, task.id);
    } else {
      // socket.close();
    }
  });

  socket.on('close', function close(log) {
    var internal = socket._socket || {};
    // console.info('['+task.id+']socket on close');
    // console.log(socket);

    var send_data = {
      type: 'close', id: task.id,
      read: internal.bytesRead || 0,
      send: internal.bytesWritten || 0
    };
    // process.send(send_data);
    metrics_datas.datas.push(send_data);

    if (inteval) {
      clearInterval(inteval);
    };
    delete connections[task.id];
    // console.log('close ', Object.keys(connections).length);
    if (Object.keys(connections) <= 0) {
      // 一次性发送
      process.send(metrics_datas);
    };
  });

  socket.on('error', function error(err) {
    console.error('['+task.id+']socket on error-------', "\n", err, "\n", '-------error');
    var send_data = { type: 'error', message: err.message, id: task.id };
    // process.send(send_data);
    metrics_datas.datas.push(send_data);

    socket.close();
    socket.emit('close');
    delete connections[task.id];
  });

  // Adding a new socket to our socket collection.
  connections[task.id] = socket;

  // timeout to close socket
  if (task.runtime && task.runtime > 0) {
    setTimeout(function timeoutToCloseSocket(id, socket) {
      // console.log('timeout to close socket:'+id);
      socket.close();
    }, task.runtime * 1000, task.id, socket);
  }
});

process.on('SIGINT', function () {
  // console.log('process.SIGINT')
});
process.on('exit', function () {
  // console.log('process.exit')
  // process.send(metrics_datas);
});

/**
 * Helper function from writing messages to the socket.
 *
 * @param {WebSocket} socket WebSocket connection we should write to
 * @param {Object} task The given task
 * @param {String} id
 * @param {Function} fn The callback
 * @api private
 */
function write(socket, task, id, fn) {
  var start = socket.last = Date.now();
  console.info("\n" + 'no no no! no write please~! ' + "\n" + 'Do that if and only if u know the server can parse ur msg, or server will cut ur connection.' + "\n");

  session[binary ? 'binary' : 'utf8'](task.size, function message(err, data) {
    socket.send(data, {
      binary: binary,
      mask: masked
    }, function sending(err) {
      if (err) {
        var send_data = { type: 'error', message: err.message };
        // process.send(send_data);
        metrics_datas.datas.push(send_data);

        socket.close();
        delete connections[id];
      }

      if (fn) fn(err);
    });
  });
}
