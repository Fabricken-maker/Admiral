// Är en port nåbar på serverns publika adresser? Används för att upptäcka om ChromaDB
// (som saknar inloggning) åter lyssnar på alla nätverk i stället för bara 127.0.0.1.
import os from 'node:os';
import net from 'node:net';

export function publicAddresses(interfaces = os.networkInterfaces()) {
  return Object.entries(interfaces)
    .filter(([name]) => !/^(lo|docker|br-|veth)/.test(name))
    .flatMap(([, list]) => list || [])
    .filter((a) => !a.internal && a.family === 'IPv4')
    .map((a) => a.address);
}

export function canConnect(host, port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port });
    const done = (ok) => { s.destroy(); resolve(ok); };
    s.setTimeout(timeoutMs, () => done(false));
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
}

export async function exposedOn(port, { addresses = publicAddresses(), connect = canConnect } = {}) {
  const open = [];
  for (const a of addresses) if (await connect(a, port)) open.push(a);
  return open;
}
