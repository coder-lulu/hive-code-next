import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { runProcess } from '../../../src/shared/child-process/run-process'

export async function createCellPrivatePki(directory: string, openssl: string) {
  const root = join(directory, 'private-pki')
  mkdirSync(root)
  const run = async (args: string[]) => {
    const result = await runProcess({ program: openssl, args, cwd: root })
    if (result.code !== 0) {
      throw new Error('Private Cell fixture certificate generation failed')
    }
  }
  await run([
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    'ca.key',
    '-out',
    'ca.pem',
    '-subj',
    '/CN=Hive isolated private fixture CA',
    '-days',
    '1',
    '-addext',
    'basicConstraints=critical,CA:TRUE',
    '-addext',
    'keyUsage=critical,keyCertSign,cRLSign'
  ])
  for (const role of ['server', 'client']) {
    await run([
      'req',
      '-new',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      `${role}.key`,
      '-out',
      `${role}.csr`,
      '-subj',
      role === 'server' ? '/CN=localhost' : '/CN=Hive fixture ops client'
    ])
    writeFileSync(
      join(root, `${role}.ext`),
      [
        'basicConstraints=critical,CA:FALSE',
        'keyUsage=critical,digitalSignature,keyEncipherment',
        `extendedKeyUsage=${role === 'server' ? 'serverAuth' : 'clientAuth'}`,
        ...(role === 'server' ? ['subjectAltName=DNS:localhost'] : [])
      ].join('\n')
    )
    await run([
      'x509',
      '-req',
      '-in',
      `${role}.csr`,
      '-CA',
      'ca.pem',
      '-CAkey',
      'ca.key',
      '-CAcreateserial',
      '-out',
      `${role}.pem`,
      '-days',
      '1',
      '-extfile',
      `${role}.ext`
    ])
  }
  await run([
    'pkcs12',
    '-export',
    '-inkey',
    'client.key',
    '-in',
    'client.pem',
    '-certfile',
    'ca.pem',
    '-out',
    'client.p12',
    '-passout',
    'pass:hive-fence-fixture'
  ])
  return {
    caPemPath: join(root, 'ca.pem'),
    serverCertPath: join(root, 'server.pem'),
    serverKeyPath: join(root, 'server.key'),
    clientCertPath: join(root, 'client.pem'),
    clientKeyPath: join(root, 'client.key'),
    clientPkcs12Path: join(root, 'client.p12')
  }
}
