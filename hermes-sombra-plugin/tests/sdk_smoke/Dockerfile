FROM python@sha256:9aaa474097d094040649f2162a627c0049b408f52138d980916788d80f04802f
LABEL org.sombra.qa.goal="hermes-platform-integration" org.sombra.hermes.commit="bf0203a794a07aac3ff764972ab9087baa4e4f4e"
COPY hermes-clean.tar /tmp/hermes-clean.tar
COPY provenance.json /tmp/provenance.json
RUN python -c "import hashlib,json; p=json.load(open('/tmp/provenance.json')); assert hashlib.sha256(open('/tmp/hermes-clean.tar','rb').read()).hexdigest()==p['archive_sha256']" \
 && mkdir /opt/hermes && tar -xf /tmp/hermes-clean.tar -C /opt/hermes \
 && cd /opt/hermes \
 && python -c "from pathlib import Path; from pm.operations import build_environment; build_environment(source=Path('/opt/hermes'),out=Path('/opt/venv'),python=Path('/usr/local/bin/python'),frozen=False,explicit=True,timeout=900)"
COPY plugin.tar /tmp/plugin.tar
RUN mkdir /opt/sombra-plugin && tar -xf /tmp/plugin.tar -C /opt/sombra-plugin
COPY smoke.py entry.py /opt/qa/
ENV PYTHONPATH=/opt/hermes PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
ENTRYPOINT ["/opt/venv/bin/python", "/opt/qa/entry.py"]
