// The Node tools must not fetch missing resources in the compilation phase.
const net = require('node:net')
const original = net.Socket.prototype.connect
net.Socket.prototype.connect = function (...args) {
  const value = Array.isArray(args[0]) ? args[0] : args
  const option = value[0]
  const host =
    typeof option === 'object' ? option.host : typeof value[1] === 'string' ? value[1] : 'localhost'
  const socketPath =
    typeof option === 'object' ? option.path : typeof option === 'string' && !/^\d+$/.test(option)
  if (!socketPath && host && !['localhost', '127.0.0.1', '::1'].includes(host)) {
    throw new Error(
      `[clients:offline] Network resource requested from ${host}; run clients:prepare`
    )
  }
  return original.apply(this, args)
}
