"""Read-only public deployment smoke: no account or message is created."""
import json
import urllib.request
import urllib.error

BASE='https://sombra.mi-nerva.ru'
assert urllib.request.urlopen(BASE+'/health', timeout=20).read()==b'Mines ready'

def post(payload):
    request=urllib.request.Request(BASE+'/api',data=payload,headers={'Content-Type':'application/json'},method='POST')
    try:
        response=urllib.request.urlopen(request,timeout=90)
        return response.status,response.read()
    except urllib.error.HTTPError as response:
        return response.code,response.read()

status,body=post(json.dumps({'op':'attachment_file','message':'not-a-real-message'}).encode())
assert status==401,(status,body[:120])
print('PASS public attachment read requires authentication')
# Full-size upload body must pass nginx (used to be capped at 2MiB), but never authenticate.
status,body=post(json.dumps({'op':'message','channel':'not-a-real-channel','attachment':{'name':'limit.bin','data':'A'*13981016}}).encode())
assert status==401,(status,body[:120])
print('PASS full 10MiB base64 request reaches API and is rejected without a session')
status,_=post(b' '*(15*1024*1024+1))
assert status==413,status
print('PASS request body above 15MiB rejected with HTTP 413')
print('PASS public health')
