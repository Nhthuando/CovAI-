import sys, json, http.client
data = json.loads(sys.stdin.read(1024 * 1024 + 1))
port = data.get('port', 3000)
endpoint = data.get('path', '')
if not isinstance(port, int) or not 1 <= port <= 65535 or not endpoint.startswith('/') or endpoint.startswith('//'):
    raise ValueError('INVALID_LOCAL_TARGET')
connection = http.client.HTTPConnection('127.0.0.1', port, timeout=min(data.get('timeoutMs', 60000) / 1000, 120))
try:
    method = data.get('method', 'POST')
    if method not in ('GET', 'POST'):
        raise ValueError('INVALID_LOCAL_METHOD')
    connection.request(method, endpoint, json.dumps(data['body']) if method == 'POST' else None, {'Content-Type': 'application/json'})
    response = connection.getresponse()
    body = response.read(1024 * 1024 + 1)
    if len(body) > 1024 * 1024:
        raise ValueError('RESPONSE_TOO_LARGE')
    print(json.dumps({'status': response.status, 'contentType': response.getheader('Content-Type', ''), 'body': body.decode('utf-8')}))
except ConnectionRefusedError:
    print(json.dumps({'transportError': 'LOCAL_CONNECTION_REFUSED', 'dispatched': False}))
except Exception:
    print(json.dumps({'transportError': 'LOCAL_REQUEST_FAILED', 'dispatched': True}))
finally:
    connection.close()
