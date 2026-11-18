const $ = (id) => document.getElementById(id);

let state = null;
let currentSteps = [];
let saveMode = 'existing';
let saved = false;
let loadedRecordingKey = '';
let scenariosCache = [];

const TYPE_LABEL = {
  navigate: 'Sahifa',
  click: 'Bosish',
  fill: 'To‘ldirish',
  sign: 'Imzo',
  wait: 'Kutish',
  check: 'Tekshirish',
  'eimzo-login': 'E-IMZO',
  'password-login': 'Parol',
  manual: 'Qo‘lda',
  loop: 'Takror',
  condition: 'Shart',
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function showMsg(node, tone, text) {
  if (!node) return;
  node.className = `msg show ${tone}`;
  node.textContent = text;
}

function hideMsg(node) {
  if (!node) return;
  node.className = 'msg';
  node.textContent = '';
}

function setBadge(node, tone, text) {
  node.className = `badge${tone ? ` ${tone}` : ''}`;
  node.textContent = text;
}

function fmtTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString('uz-UZ', { hour12: false });
  } catch {
    return iso;
  }
}

function apply(stamp) {
  state = stamp;
  $('version').textContent = `v${stamp.version}`;
  $('configPath').textContent = stamp.configFile ?? '';

  if (!$('apiUrl').value) $('apiUrl').value = stamp.config?.apiUrl ?? 'http://localhost:3100';
  $('robotToken').placeholder = stamp.config?.hasToken ? '•••• saqlangan token' : 'Token kiritilmagan';
  setBadge($('tokenBadge'), stamp.config?.hasToken ? 'ok' : 'err', stamp.config?.hasToken ? 'token bor' : 'token yo‘q');

  let connText = 'Ulanmagan';
  let connTone = '';
  if (stamp.polling && stamp.connected) {
    connText = stamp.busy ? 'Vazifa bajarilmoqda' : 'Navbat kuzatilmoqda';
    connTone = 'ok';
  } else if (stamp.polling) {
    connText = 'Aloqa yo‘q';
    connTone = 'warn';
  } else if (stamp.connected) {
    connText = 'Ulandi';
    connTone = 'ok';
  }
  $('connText').textContent = connText;
  $('connDot').className = `dot${connTone ? ` ${connTone}` : ''}${stamp.polling ? ' pulse' : ''}`;

  setBadge($('pollBadge'), stamp.busy ? 'blue' : stamp.polling ? 'ok' : '', stamp.busy ? 'Ishlamoqda' : stamp.polling ? 'Faol' : 'To‘xtatilgan');
  const pollBtn = $('btnPoll');
  pollBtn.textContent = stamp.polling ? 'To‘xtatish' : 'Ishga tushirish';
  pollBtn.className = stamp.polling ? 'ghost wide big' : 'primary wide big';
  pollBtn.disabled = Boolean(stamp.busy);

  const job = stamp.job;
  $('jobName').textContent = job ? job.farmName : stamp.polling ? 'Navbat kutilmoqda…' : 'Robot to‘xtatilgan';
  $('jobSub').textContent = job
    ? `${job.scenarioName} · ${job.mode === 'live' ? 'imzolash rejimi' : 'dry run'}`
    : stamp.polling
      ? 'Yangi ferma vazifasi kelganda avtomatik boshlanadi.'
      : 'Ishga tushiring — robot navbatdan vazifa oladi.';
  const stepNode = $('jobStep');
  if (stamp.paused) {
    stepNode.hidden = false;
    stepNode.textContent = `To‘xtatilgan · ${stamp.currentStep ?? 'qadam kutilmoqda'}`;
  } else if (stamp.currentStep) {
    stepNode.hidden = false;
    stepNode.textContent = stamp.currentStep;
  } else {
    stepNode.hidden = true;
  }

  $('manualBox').hidden = !stamp.manual;
  if (stamp.manual) $('manualMsg').textContent = stamp.manual.message;

  const rec = stamp.recorder;
  $('recStatus').hidden = !rec;
  if (rec) $('recText').textContent = `Yozib olinmoqda · ${rec.count} hodisa · ${rec.lastEvent}`;
  setBadge($('recBadge'), rec ? 'blue' : stamp.recorded ? 'ok' : '', rec ? 'Yozilmoqda' : stamp.recorded ? 'Tayyor' : 'Bo‘sh');
  $('btnStop').hidden = !rec;
  $('btnRecord').disabled = Boolean(rec);
  $('btnRecord').textContent = rec ? 'Yozib olinmoqda…' : 'Oynani ochish va yozish';
  if (stamp.recorded && !rec) {
    $('recInfo').textContent = `Oxirgi yozuv: ${stamp.recorded.steps} qadam`;
    const key = `${stamp.recorded.steps}|${stamp.recorded.startUrl}`;
    if (key !== loadedRecordingKey) {
      loadedRecordingKey = key;
      void loadCurrentRecording();
    }
  } else if (!rec) {
    $('recInfo').textContent = '';
  }

  renderLog(stamp.log ?? []);
}

function renderLog(entries) {
  const box = $('log');
  const nearBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 24;
  $('logCount').textContent = String(entries.length);
  if (!entries.length) {
    box.innerHTML = '<p class="log-empty">Hodisalar shu yerda ko‘rinadi.</p>';
    return;
  }
  box.innerHTML = entries
    .map(
      (entry) =>
        `<div class="log-row ${entry.level}"><span class="log-time">${escapeHtml(fmtTime(entry.at))}</span><span class="log-msg">${escapeHtml(entry.message)}</span></div>`,
    )
    .join('');
  if (nearBottom) box.scrollTop = box.scrollHeight;
}

function renderSteps() {
  $('stepsCount').textContent = String(currentSteps.length);
  const list = $('stepsList');
  if (!currentSteps.length) {
    list.innerHTML = '<li><span class="step-index">—</span><span class="step-body"><span class="step-desc">Qadamlar yo‘q.</span></span></li>';
    return;
  }
  list.innerHTML = currentSteps
    .map((step, index) => {
      const secret = step.type === 'fill' && step.secret;
      const label = TYPE_LABEL[step.type] ?? step.type;
      const meta = step.type === 'navigate' ? step.url : step.selector ?? '';
      return `<li>
        <span class="step-index">${index + 1}</span>
        <span class="step-type${secret ? ' secret' : ''}">${escapeHtml(secret ? 'Maxfiy' : label)}</span>
        <span class="step-body">
          <span class="step-desc">${escapeHtml(step.description || label)}</span>
          ${meta ? `<span class="step-meta">${escapeHtml(meta)}</span>` : ''}
        </span>
      </li>`;
    })
    .join('');
}

async function loadCurrentRecording() {
  try {
    const result = await window.robot.currentRecording();
    if (result?.ok && result.recording?.steps?.length) {
      currentSteps = result.recording.steps;
      saved = false;
      $('savePanel').hidden = false;
      $('btnSaveRecording').disabled = false;
      $('btnSaveRecording').textContent = 'Versiya sifatida saqlash';
      hideMsg($('saveMsg'));
      renderSteps();
      void loadScenarios();
    }
  } catch {
    /* ignored */
  }
}

async function loadScenarios() {
  const result = await window.robot.scenarios();
  if (!result?.ok) {
    showMsg($('saveMsg'), 'err', result?.message ?? 'Scenariolar ro‘yxatini olib bo‘lmadi.');
    return;
  }
  scenariosCache = result.scenarios ?? [];
  const select = $('scenarioSelect');
  if (!scenariosCache.length) {
    select.innerHTML = '<option value="">— faol scenario yo‘q —</option>';
    return;
  }
  select.innerHTML = scenariosCache
    .map(
      (scenario) =>
        `<option value="${escapeHtml(scenario.id)}">${escapeHtml(scenario.name)} · ${escapeHtml(scenario.platform)} · v${scenario.version} · ${scenario.stepsCount} qadam</option>`,
    )
    .join('');
}

function setSaveMode(mode) {
  saveMode = mode;
  $('tabExisting').classList.toggle('active', mode === 'existing');
  $('tabNew').classList.toggle('active', mode === 'new');
  $('existingPane').hidden = mode !== 'existing';
  $('newPane').hidden = mode !== 'new';
}

function bind() {
  $('btnSave').addEventListener('click', async () => {
    const payload = { apiUrl: $('apiUrl').value, robotToken: $('robotToken').value };
    setBadge($('tokenBadge'), '', 'tekshirilmoqda…');
    const result = await window.robot.saveConfig(payload);
    if (result.ok) {
      showMsg($('configMsg'), 'ok', 'Ulanish saqlandi. Robot tokeni ishlayapti.');
      $('robotToken').value = '';
    } else {
      showMsg($('configMsg'), 'err', result.message ?? 'Ulanishda xato.');
    }
  });

  $('btnPeek').addEventListener('click', () => {
    const input = $('robotToken');
    input.type = input.type === 'password' ? 'text' : 'password';
  });

  $('btnPoll').addEventListener('click', async () => {
    if (state?.polling) {
      await window.robot.stopPolling();
      return;
    }
    const result = await window.robot.startPolling();
    if (!result.ok) showMsg($('configMsg'), 'err', result.message ?? 'Ishga tushirib bo‘lmadi.');
  });

  $('btnContinue').addEventListener('click', async () => {
    await window.robot.continueRun();
  });

  $('btnAbort').addEventListener('click', async () => {
    await window.robot.abortRun();
  });

  $('btnRecord').addEventListener('click', async () => {
    const url = $('recUrl').value.trim();
    const platform = $('platform').value;
    const result = await window.robot.startRecording({ url, platform });
    if (!result.ok) showMsg($('saveMsg'), 'err', result.message ?? 'Yozib olishni boshlab bo‘lmadi.');
    else hideMsg($('saveMsg'));
  });

  $('btnStop').addEventListener('click', async () => {
    const result = await window.robot.stopRecording();
    if (result?.steps?.length) {
      currentSteps = result.steps;
      saved = false;
      loadedRecordingKey = `${result.steps.length}|${$('recUrl').value}`;
      $('savePanel').hidden = false;
      $('btnSaveRecording').disabled = false;
      $('btnSaveRecording').textContent = 'Versiya sifatida saqlash';
      hideMsg($('saveMsg'));
      renderSteps();
      void loadScenarios();
    } else if (result?.message) {
      showMsg($('saveMsg'), 'err', result.message);
    }
  });

  $('tabExisting').addEventListener('click', () => setSaveMode('existing'));
  $('tabNew').addEventListener('click', () => setSaveMode('new'));

  $('btnDiscard').addEventListener('click', async () => {
    await window.robot.discardRecording();
    currentSteps = [];
    loadedRecordingKey = '';
    $('savePanel').hidden = true;
    hideMsg($('saveMsg'));
  });

  $('btnSaveRecording').addEventListener('click', async () => {
    if (!currentSteps.length) return;
    const payload = { steps: currentSteps, platform: $('platform').value };
    if (saveMode === 'existing') {
      const scenarioId = $('scenarioSelect').value;
      if (!scenarioId) {
        showMsg($('saveMsg'), 'err', 'Avval scenarioni tanlang yoki «Yangi scenario»ni tanlang.');
        return;
      }
      payload.scenarioId = scenarioId;
    } else {
      payload.name = $('newName').value;
      payload.folder = $('newFolder').value;
    }
    $('btnSaveRecording').disabled = true;
    const result = await window.robot.saveRecording(payload);
    if (result.ok) {
      saved = true;
      $('btnSaveRecording').textContent = `Saqlangan · v${result.scenario.version}`;
      showMsg($('saveMsg'), 'ok', `«${result.scenario.name}» v${result.scenario.version} saqlandi. Dry run qilib, keyin live’ga o‘ting.`);
      void loadScenarios();
    } else {
      $('btnSaveRecording').disabled = false;
      showMsg($('saveMsg'), 'err', result.message ?? 'Saqlashda xato.');
    }
  });

  setSaveMode('existing');
  renderSteps();
  window.robot.onState(apply);
}

void (async () => {
  bind();
  try {
    const info = await window.robot.info();
    apply(info);
  } catch (error) {
    showMsg($('configMsg'), 'err', `Ilova holatini olib bo‘lmadi: ${error}`);
  }
})();
