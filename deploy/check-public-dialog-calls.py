import json
import urllib.request
import urllib.error
base='https://sombra.mi-nerva.ru'
assert urllib.request.urlopen(base+'/health',timeout=20).read()==b'Mines ready'
for operation, fields in [('dialog_call_start',{'dialog':'not-a-dialog','video':False}),('dialog_call_decline',{'call':'not-a-call'}),('dialog_call_cancel',{'call':'not-a-call'})]:
    request=urllib.request.Request(base+'/api',data=json.dumps({'op':operation,**fields}).encode(),headers={'Content-Type':'application/json'},method='POST')
    try:
        urllib.request.urlopen(request,timeout=20)
        raise AssertionError(operation+' unexpectedly allowed')
    except urllib.error.HTTPError as response:
        assert response.code==401,(operation,response.code)
    print('PASS authenticated-only '+operation)
print('PASS public health')
