import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import os from 'node:os';

const scripts = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(scripts, 'package.json'));
const { WebSocket } = require('ws');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'edge-bridge-verify-'));
const stateDir = path.join(stateRoot, 'CodexEdgeControl');
const probe = net.createServer();
await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const token = randomBytes(48).toString('base64');
await fs.mkdir(stateDir, { recursive: true });
await fs.writeFile(path.join(stateDir, 'config.json'), JSON.stringify({host:'127.0.0.1',port,authToken:token,bridgePath:'/bridge'}));
const childEnv = {...process.env, APPDATA: stateRoot};
const bridge = spawn(process.execPath, ['bridge-server.mjs'], {cwd:scripts,env:childEnv,windowsHide:true,stdio:['ignore','pipe','pipe']});
let bridgeErrors = '';
bridge.stderr.on('data', chunk => { bridgeErrors += chunk; });
const baseUrl = `http://127.0.0.1:${port}`;
const request = (route, options={}) => fetch(baseUrl + route, {...options,headers:{'content-type':'application/json','x-edge-control-token':token,...options.headers},signal:AbortSignal.timeout(5000)});
const checks = [];
let socket, client;
try {
  let ready = false;
  for(let attempt=0; attempt<50; attempt++) {
    try { if((await request('/api/status')).ok){ready=true;break;} } catch {}
    await new Promise(resolve => setTimeout(resolve,100));
  }
  assert.ok(ready, bridgeErrors || 'Bridge failed to start');
  checks.push('bridge starts on loopback');
  assert.equal((await request('/api/status',{headers:{'x-edge-control-token':'invalid'}})).status,401);
  checks.push('invalid HTTP token rejected');
  const disconnected = await (await request('/api/status')).json();
  assert.equal(disconnected.bridge.connectedExtension,false);
  assert.equal((await request('/api/command',{method:'POST',body:JSON.stringify({command:'list_tabs'})})).status,503);
  checks.push('no-extension state and command rejection');
  socket = new WebSocket(`ws://127.0.0.1:${port}/bridge?role=edge-extension&token=${encodeURIComponent(token)}&runtimeId=smoke-fixture&version=0.1.7`);
  let helloAck = false;
  const fixtureTabs = [{id:424242,title:'SIMULATED transport test fixture',url:'https://example.invalid/'}];
  socket.on('message', buffer => {
    const message = JSON.parse(buffer.toString());
    if(message.type==='hello_ack') helloAck=true;
    if(message.type==='ping') socket.send(JSON.stringify({type:'pong',pingId:message.pingId}));
    if(message.type==='command') socket.send(JSON.stringify({type:'response',requestId:message.requestId,ok:true,result:message.command==='list_tabs'?fixtureTabs:{fixture:true}}));
  });
  await once(socket,'open');
  socket.send(JSON.stringify({type:'hello',extension:{runtimeId:'smoke-fixture',version:'0.1.7'}}));
  for(let attempt=0; attempt<20&&!helloAck; attempt++) await new Promise(resolve=>setTimeout(resolve,50));
  assert.ok(helloAck);
  assert.equal((await (await request('/api/status')).json()).bridge.healthyExtension,true);
  checks.push('WebSocket hello handshake and healthy state');
  const relayed = await (await request('/api/command',{method:'POST',body:JSON.stringify({command:'list_tabs',args:{}})})).json();
  assert.deepEqual(relayed.result,fixtureTabs);
  checks.push('HTTP-to-WebSocket command relay (simulated extension)');
  client = new Client({name:'local-bridge-check',version:'1.0.0'});
  const transport = new StdioClientTransport({command:process.execPath,args:[path.join(scripts,'mcp-server.mjs')],cwd:scripts,env:childEnv,stderr:'pipe'});
  await client.connect(transport);
  const tools = await client.listTools();
  for(const toolName of ['edge_bridge_status','edge_list_tabs','edge_get_dom','edge_click','edge_type','edge_send_cdp']) assert.ok(tools.tools.some(tool=>tool.name===toolName),toolName);
  checks.push(`MCP starts and exposes ${tools.tools.length} tools`);
  const mcpStatus = await client.callTool({name:'edge_bridge_status',arguments:{}});
  assert.ok(!mcpStatus.isError);
  assert.equal(JSON.parse(mcpStatus.content[0].text).bridge.healthyExtension,true);
  const mcpTabs = await client.callTool({name:'edge_list_tabs',arguments:{}});
  assert.ok(!mcpTabs.isError);
  assert.deepEqual(JSON.parse(mcpTabs.content[0].text),fixtureTabs);
  checks.push('MCP status and tab command roundtrip (simulated extension)');
  const result = {passed:true,checks,realEdgeTested:false,scope:'Transport/MCP tests use a simulated extension, not a real Edge browser.'};
  console.log(JSON.stringify(result,null,2));
} finally {
  if(client) await client.close().catch(()=>{});
  if(socket) socket.terminate();
  bridge.kill();
  await fs.unlink(path.join(stateDir,'config.json')).catch(()=>{});
  await fs.rmdir(stateDir).catch(()=>{});
  await fs.rmdir(stateRoot).catch(()=>{});
}
