(() => {
  'use strict';

  const { parse, format, bits, ports, connect, evaluate, advance } = FixedPoint;
  const $ = id => document.getElementById(id);
  const kinds = {
    input: ['输入', '↦', 'A'], constant: ['常数', '#', 'K'], output: ['输出', '↤', 'Y'],
    add: ['加法', '+', 'ADD'], left: ['左移', '≪', 'SHL'], right: ['右移', '≫', 'SHR'], delay: ['延迟线', '↷', 'DLY'],
  };
  const node = (id, type, name, x, y, value = 0) => ({ id, type, name, x, y, ticks: parse(value) });
  const output = () => node('y', 'output', 'Y', 605, 219);
  const wire = (from, to, port) => ({ from, to, port });
  const levels = [
    {
      title: '两数之和', description: '补上一条线，让输出 Y 得到 A 和 B 的和。', formula: 'Y = A + B',
      inputs: ['a', 'b'], cases: [[2.5, 1.25, 3.75], [-1.5, 0.75, -0.75], [0.0625, 0.9375, 1]],
      nodes: [node('a', 'input', 'A', 43, 114), node('b', 'input', 'B', 43, 332), node('add', 'add', 'ADD', 322, 219), output()],
      wires: [wire('a', 'add', 'A'), wire('add', 'y', 'IN')],
    },
    {
      title: '向左放大', description: '将输入 B 接到移位量 N，让 A 左移 B 位。', formula: 'Y = A << B',
      inputs: ['a', 'n'], cases: [[1.25, 1, 2.5], [-0.75, 2, -3], [0.0625, 3, 0.5], [1.125, 0, 1.125]],
      nodes: [node('a', 'input', 'A', 43, 114), node('n', 'input', 'B', 43, 332), node('left', 'left', 'SHL', 322, 219), output()], wires: [],
    },
    {
      title: '向右缩小', description: '将输入 B 接到移位量 N，让 A 右移 B 位。', formula: 'Y = A >> B',
      inputs: ['a', 'n'], cases: [[5.5, 1, 2.75], [-1.1875, 1, -0.5625], [0.0625, 1, 0], [3.75, 2, 0.9375]],
      nodes: [node('a', 'input', 'A', 43, 114), node('n', 'input', 'B', 43, 332), node('right', 'right', 'SHR', 322, 219), output()], wires: [],
    },
    {
      title: '两数的平均值', description: '先求 A 和 B 的和，再用常数 1 作为移位量，将和右移一位。', formula: 'Y = (A + B) >> 1',
      inputs: ['a', 'b'], cases: [[3.5, 1.25, 2.375], [-2, 1.25, -0.375], [-0.25, -0.1875, -0.1875], [0.0625, 0.125, 0.0625]],
      nodes: [node('a', 'input', 'A', 43, 114), node('b', 'input', 'B', 43, 332), output()], wires: [],
    },
  ];
  const width = 820;
  const height = 525;
  const storageKey = 'fixed-point-workshop-v1';
  const defaultHint = '先选输出圆点，再选输入圆点，即可接线。';
  const svgNS = 'http://www.w3.org/2000/svg';
  const inputNames = ['A', 'B', 'C', 'D'];
  const inputY = index => 64 + index * 110;
  let save;
  try { save = JSON.parse(localStorage.getItem(storageKey)) || {}; } catch { save = {}; }
  const boards = save.boards || {};
  const passed = save.passed || {};
  if (!save.inputPanel) migrateInputs();
  let levelIndex = Number.isInteger(save.levelIndex) && levels[save.levelIndex] ? save.levelIndex : 0;
  let sandbox = save.sandbox === true;
  let graph = boards[boardKey()] || starter();
  let currentCase = 0;
  let sampleValues = {};
  let delays = {};
  let tick = 0;
  let results = null;
  let selection = null;
  let source = null;
  let drag = null;
  let wireDrag = null;
  let editedId = null;
  let zoom = 1;
  let autoZoom = true;
  const undo = [];
  const redo = [];

  function boardKey() { return sandbox ? 'sandbox' : `level-${levelIndex}`; }

  function migrateInputs() {
    for (const index of [1, 2]) {
      const input = boards[`level-${index}`]?.nodes.find(item => item.id === 'n');
      if (input) input.name = 'B';
    }
    const board = boards.sandbox;
    if (!board) return;
    const inputs = board.nodes.filter(item => item.type === 'input');
    for (const [index, name] of inputNames.entries()) {
      if (inputs[index]) {
        inputs[index].name = name;
        continue;
      }
      const y = inputY(index);
      const overlaps = board.nodes.some(item => Math.abs(item.y - y) < 104 && Math.abs(item.x - 43) < 174);
      board.nodes.push(node(`input-${name}`, 'input', name, overlaps ? 236 : 43, y));
    }
  }
  function starter() {
    if (!sandbox) {
      const { nodes, wires } = levels[levelIndex];
      return structuredClone({ nodes, wires });
    }
    const inputs = inputNames.map((name, index) => node(name.toLowerCase(), 'input', name, 43, inputY(index), index ? 0 : 1.5));
    return { nodes: [...inputs, output()], wires: [wire('a', 'y', 'IN')] };
  }

  function persist() {
    boards[boardKey()] = graph;
    try {
      localStorage.setItem(storageKey, JSON.stringify({ boards, passed, levelIndex, sandbox, inputPanel: true }));
      $('save-status').textContent = '电路保存在当前浏览器';
    } catch {
      $('save-status').textContent = '当前浏览器无法保存电路';
    }
  }

  function hint(message = defaultHint, warning = false) {
    $('board-hint').textContent = message;
    $('board-hint').classList.toggle('warning', warning);
  }

  function commit(next, message) {
    undo.push(graph);
    if (undo.length > 60) undo.shift();
    redo.length = 0;
    graph = next;
    finishEdit(message);
  }

  function finishEdit(message) {
    results = null;
    source = null;
    wireDrag = null;
    persist();
    render();
    hint(message);
  }

  function travel(from, to, message) {
    if (!from.length) return;
    to.push(graph);
    graph = from.pop();
    selection = null;
    finishEdit(message);
  }

  function switchBoard(nextSandbox, index = levelIndex) {
    if (nextSandbox === sandbox && index === levelIndex) return;
    persist();
    sandbox = nextSandbox;
    levelIndex = index;
    graph = boards[boardKey()] || starter();
    undo.length = 0;
    redo.length = 0;
    currentCase = 0;
    sampleValues = {};
    delays = {};
    tick = 0;
    selection = null;
    finishEdit();
  }

  function caseInputs(index) {
    if (sandbox) return {};
    const { inputs, cases } = levels[levelIndex];
    return Object.fromEntries(inputs.map((id, i) => [id, parse(cases[index][i])]));
  }

  function liveInputs() {
    return { ...caseInputs(currentCase), ...Object.fromEntries(Object.entries(sampleValues).map(([id, value]) => [id, value.ticks])) };
  }

  function availableInput() {
    return inputNames.find(name => !graph.nodes.some(item => item.type === 'input' && item.name === name));
  }

  function inputIsNegative(item, ticks) {
    return ticks < 0 || (ticks === 0 && Boolean(sandbox ? item.negativeZero : sampleValues[item.id]?.negativeZero));
  }

  function inputBits(item, ticks) {
    const [, whole, fraction] = bits(ticks);
    const minus = inputIsNegative(item, ticks);
    const cell = (bit, digit, label, pressed = digit === '1') => `<button type="button" class="bit-cell${bit === 'sign' ? ' sign' : ''}" data-bit="${bit}" aria-label="${item.name} ${label}" aria-pressed="${pressed}" title="${label}">${digit}</button>`;
    const integers = [...whole].map((digit, i) => cell(7 - i, digit, `整数位 ${2 ** (3 - i)}`)).join('');
    const fractions = [...fraction].map((digit, i) => cell(3 - i, digit, `小数位 ${2 ** (-i - 1)}`)).join('');
    return `<div class="input-bits" role="group" aria-label="${item.name} 的符号、整数和小数">${cell('sign', minus ? '−' : '+', '符号位', minus)}${integers}<span aria-hidden="true">.</span>${fractions}</div>`;
  }

  function bitText(value) {
    if (value?.ticks === undefined) return '·  ────.────';
    const [sign, whole, fraction] = bits(value.ticks);
    return `${sign}  ${whole}.${fraction}`;
  }

  function describesSelection() {
    if (selection?.kind === 'node') {
      const item = graph.nodes.find(item => item.id === selection.id);
      return item && `${kinds[item.type][0]} ${item.name}`;
    }
    return selection?.kind === 'wire' ? '导线' : null;
  }

  function mandatory(item) {
    return !sandbox && [...levels[levelIndex].inputs, 'y'].includes(item.id);
  }

  function updateToolbar() {
    $('undo').disabled = undo.length === 0;
    $('redo').disabled = redo.length === 0;
    const item = selection?.kind === 'node' && graph.nodes.find(item => item.id === selection.id);
    $('delete').disabled = !selection || Boolean(item && mandatory(item));
    const hasDelay = graph.nodes.some(item => item.type === 'delay');
    $('step').disabled = !hasDelay;
    $('step').textContent = tick ? `下一步 · ${tick}` : '下一步';
  }

  function render() {
    $('challenge').setAttribute('aria-pressed', String(!sandbox));
    $('sandbox').setAttribute('aria-pressed', String(sandbox));
    $('level-navigation').hidden = sandbox;
    $('prev').disabled = levelIndex === 0;
    $('next').disabled = levelIndex === levels.length - 1;
    $('levels').innerHTML = levels.map((level, index) => `<option value="${index}">${String(index + 1).padStart(2, '0')} / ${String(levels.length).padStart(2, '0')} · ${level.title}${passed[index] ? ' ✓' : ''}</option>`).join('');
    $('levels').value = levelIndex;
    $('level-title').textContent = sandbox ? '自由搭建' : levels[levelIndex].title;
    $('level-description').textContent = sandbox ? '添加元件、修改数值，观察信号在电路中的变化。' : levels[levelIndex].description;
    $('inspector-title').textContent = sandbox ? '信号读数' : '关卡检测';
    $('node-count').textContent = `${graph.nodes.length} 节点 / ${graph.wires.length} 连线`;
    document.querySelectorAll('.shelf [data-part]').forEach(button => {
      const type = button.dataset.part;
      button.disabled = (!sandbox && ['input', 'output'].includes(type)) || (type === 'input' && !availableInput());
      button.title = button.disabled ? (sandbox ? 'A、B、C、D 均已放置' : '关卡的输入和输出由题目指定') : '点击添加到画布';
    });
    updateToolbar();
    const values = evaluate(graph, liveInputs(), delays);
    renderNodes(values);
    renderWires(values);
    renderInspector(values);
  }

  function renderNodes(values) {
    $('nodes').innerHTML = graph.nodes.map(item => {
      const [label, symbol] = kinds[item.type];
      const value = values.get(item.id);
      const number = value.ticks === undefined ? '—' : format(value.ticks);
      const editable = item.type === 'constant' || item.type === 'input';
      const selected = selection?.kind === 'node' && selection.id === item.id;
      const inlets = ports[item.type];
      const hasOutput = item.type !== 'output';
      const inletButtons = inlets.map((port, index) => {
        const connected = graph.wires.some(w => w.to === item.id && w.port === port);
        return `<button class="port in ${index === 1 ? 'second' : ''} ${connected ? 'connected' : ''} ${source && item.id !== source ? 'waiting' : ''}" type="button" data-in="${port}" aria-label="${label} ${item.name} 输入口 ${port}" title="输入 ${port}${connected ? '，右键断开' : ''}"></button>`;
      }).join('');
      const outlet = hasOutput ? `<button class="port out ${source === item.id ? 'active' : ''} ${graph.wires.some(w => w.from === item.id) ? 'connected' : ''}" type="button" data-out aria-label="${label} ${item.name} 输出口" aria-pressed="${source === item.id}" title="从这里接线"></button>` : '';
      const outletLabel = hasOutput ? '<span>OUT</span>' : '';
      const shownNumber = editable ? `<button type="button" data-edit class="node-number" aria-label="编辑 ${item.name} 的数值">${number}</button>` : `<span class="node-number ${value.error ? 'error' : ''}">${number}</span>`;
      const body = item.type === 'input' ? `${inputBits(item, value.ticks)}${shownNumber}` : `<div class="node-port-labels"><span>${inlets.map(port => `<span>${port}</span>`).join('')}</span>${outletLabel}</div>${shownNumber}<span class="node-bits" aria-label="定点表示 ${bitText(value)}">${bitText(value)}</span>`;
      return `<article data-node="${item.id}" class="node ${item.type}${selected ? ' selected' : ''}" style="left:${item.x}px;top:${item.y}px">
        <button class="node-head" type="button" aria-label="选择${label} ${item.name}" aria-pressed="${selected}"><span class="node-icon" aria-hidden="true">${symbol}</span><strong>${label}</strong><span class="node-id">${item.name}</span></button>
        <div class="node-body">${body}</div>
        ${inletButtons}${outlet}</article>`;
    }).join('');
  }

  function fromPosition(id) {
    const item = graph.nodes.find(item => item.id === id);
    return item && { x: item.x + 174, y: item.y + 56.5 };
  }

  function toPosition(id, port) {
    const item = graph.nodes.find(item => item.id === id);
    return item && { x: item.x, y: item.y + 56.5 + ports[item.type].indexOf(port) * 23 };
  }

  function curve(a, b) {
    const vector = Math.max(34, Math.min(120, Math.abs(b.x - a.x) * 0.5));
    return `M ${a.x},${a.y} C ${a.x + vector},${a.y} ${b.x - vector},${b.y} ${b.x},${b.y}`;
  }

  function renderWires(values = evaluate(graph, liveInputs(), delays)) {
    $('wires').innerHTML = graph.wires.map((w, index) => {
      const a = fromPosition(w.from);
      const b = toPosition(w.to, w.port);
      if (!a || !b) return '';
      const d = curve(a, b);
      const selected = selection?.kind === 'wire' && selection.index === index;
      return `<path class="wire${values.get(w.from)?.error ? ' invalid' : ''}${selected ? ' selected' : ''}" d="${d}"/><path class="wire-hit" data-wire="${index}" d="${d}"/>`;
    }).join('');
    if (wireDrag?.moved) {
      const a = fromPosition(wireDrag.id);
      const pending = document.createElementNS(svgNS, 'path');
      pending.setAttribute('class', 'wire pending');
      pending.setAttribute('d', curve(a, wireDrag.end));
      $('wires').append(pending);
    }
  }

  function challengeReading(values) {
    const value = values.get('y');
    const expected = levels[levelIndex].cases[currentCase].at(-1);
    const customized = Object.keys(sampleValues).length !== 0;
    return `<div class="reading"><dl><dt>期望 Y</dt><dd>${customized ? '—' : expected}</dd><dt>实际 Y</dt><dd class="actual">${value?.ticks === undefined ? '—' : format(value.ticks)}</dd></dl>${value?.error ? `<p>${value.error}</p>` : `<p class="node-bits">${bitText(value)}</p>`}${customized ? '<p>正在试算自定义值。检测使用预设样例。</p>' : ''}</div>`;
  }

  function renderInspector(values) {
    if (sandbox) {
      const items = graph.nodes.filter(item => item.type === 'output');
      const selected = selection?.kind === 'node' && graph.nodes.find(item => item.id === selection.id);
      if (selected && selected.type !== 'output') items.unshift(selected);
      $('inspection-content').innerHTML = `<section class="inspection-section"><div class="inspection-kicker"><h3>实时数值</h3></div>${items.map(item => {
        const value = values.get(item.id);
        return `<div class="reading"><dl><dt>${item.name}</dt><dd class="actual">${value.ticks === undefined ? '—' : format(value.ticks)}</dd></dl><p>${value.error || bitText(value)}</p></div>`;
      }).join('') || '<p class="inspection-text">添加输出节点或选择节点，查看信号。</p>'}</section>`;
      return;
    }
    const { cases, inputs, formula, nodes } = levels[levelIndex];
    const caseCards = cases.map((values, index) => {
      const badge = results ? (results[index] ? '✓' : '×') : '·';
      const status = results ? (results[index] ? '通过' : '未通过') : '未检测';
      const sample = inputs.map((id, i) => `${nodes.find(item => item.id === id).name}=${values[i]}`).join(' / ');
      return `<button class="case" type="button" data-case="${index}" aria-pressed="${index === currentCase}" aria-label="样例 ${index + 1}，${sample}，${status}"><span class="case-index">${String(index + 1).padStart(2, '0')}</span><span class="case-values">${sample}</span><span class="case-status ${badge === '×' ? 'fail' : ''}" aria-hidden="true">${badge}</span></button>`;
    }).join('');
    const total = results?.filter(Boolean).length;
    const message = total === cases.length ? `关卡通过 · ${total}/${cases.length} 组符合目标` : `通过 ${total}/${cases.length} 组，请检查标记为 × 的样例。`;
    $('inspection-content').innerHTML = `
      <section class="inspection-section objective"><div class="inspection-kicker"><h3>目标</h3>${passed[levelIndex] ? '<span>✓ 已通关</span>' : ''}</div><div class="formula">${formula.replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</div></section>
      <section class="inspection-section"><div class="inspection-kicker"><h3>样例输入</h3><span>${cases.length} 组</span></div><div class="cases">${caseCards}</div></section>
      <section class="inspection-section"><div class="inspection-kicker"><h3>实时输出</h3></div>${challengeReading(values)}</section>
      <section class="inspection-section actions"><button class="primary" type="button" id="check">▶ 检测电路</button>${results ? `<p class="check-result${total === cases.length ? '' : ' fail'}" role="status">${message}</p>` : ''}</section>`;
  }

  function addPart(type) {
    if (graph.nodes.length >= 50) return hint('画布最多支持 50 个节点。', true);
    if (!sandbox && ['input', 'output'].includes(type)) return;
    const inputName = type === 'input' ? availableInput() : null;
    if (type === 'input' && !inputName) return;
    const base = kinds[type][2];
    let index = 1;
    while (graph.nodes.some(item => item.name === `${base}${index}`)) index += 1;
    const choices = [
      [253, 112], [459, 112], [322, 219], [252, 352], [459, 352], [605, 55], [43, 55],
      [605, 354], [43, 363], [312, 51], [312, 370],
    ];
    if (inputName) choices.unshift([43, inputY(inputNames.indexOf(inputName))]);
    const slot = choices.find(([x, y]) => graph.nodes.every(item => Math.abs(x - item.x) >= 183 || Math.abs(y - item.y) >= (inputName && item.type === 'input' ? 104 : 133)));
    const [x, y] = slot || [222 + (graph.nodes.length * 51) % 355, 70 + (graph.nodes.length * 47) % 301];
    const part = node(`part-${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`, type, inputName || `${base}${index}`, x, y, type === 'constant' ? 1 : 0);
    selection = { kind: 'node', id: part.id };
    commit({ ...graph, nodes: [...graph.nodes, part] }, `已添加${kinds[type][0]} ${part.name}。`);
    $('nodes').querySelector(`[data-node="${part.id}"]`).scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function select(next) {
    source = null;
    selection = next;
    render();
    const label = describesSelection();
    hint(label ? `已选中${label}。` : defaultHint);
  }

  function activateOutlet(id) {
    source = source === id ? null : id;
    selection = null;
    render();
    $('nodes').querySelector(`[data-node="${id}"] [data-out]`).focus({ preventScroll: true });
    hint(source ? '已选择输出口。点击目标节点的输入圆点。' : defaultHint);
  }

  function completeWire(from, to, port) {
    try {
      const next = connect(graph, from, to, port);
      selection = null;
      commit(next, '接线完成。');
      $('nodes').querySelector(`[data-node="${to}"] [data-in="${port}"]`).focus({ preventScroll: true });
    } catch (error) {
      hint(error.message, true);
    }
  }

  function removeSelected() {
    if (!selection) return;
    if (selection.kind === 'wire') {
      const { index } = selection;
      selection = null;
      commit({ ...graph, wires: graph.wires.filter((_, i) => i !== index) }, '已断开导线。');
      return;
    }
    const { id } = selection;
    if (mandatory(graph.nodes.find(item => item.id === id))) return hint('此节点是关卡指定的接口。', true);
    selection = null;
    commit({ nodes: graph.nodes.filter(item => item.id !== id), wires: graph.wires.filter(w => w.from !== id && w.to !== id) }, '已删除元件及相连的导线。');
  }

  function showEditor(id) {
    const item = graph.nodes.find(item => item.id === id);
    editedId = id;
    $('value-title').textContent = `编辑 ${kinds[item.type][0]} ${item.name}`;
    $('value-input').value = format(item.type === 'input' && !sandbox ? liveInputs()[id] : item.ticks);
    $('value-error').textContent = '范围 ±15.9375，步长 0.0625';
    $('value-dialog').showModal();
    $('value-input').select();
  }

  function applyValue(id, ticks, negativeZero = false) {
    if (!sandbox && Object.hasOwn(caseInputs(currentCase), id)) {
      sampleValues[id] = { ticks, negativeZero };
      results = null;
      render();
      hint('已更新试算输入。点选样例可恢复预设值。');
      return;
    }
    commit({ ...graph, nodes: graph.nodes.map(item => item.id === id ? { ...item, ticks, negativeZero } : item) }, '已应用新数值。');
  }

  function toggleInputBit(id, bit) {
    const item = graph.nodes.find(item => item.id === id);
    const ticks = sandbox ? item.ticks : liveInputs()[id];
    const minus = inputIsNegative(item, ticks);
    const sign = bit === 'sign' ? !minus : minus;
    const magnitude = bit === 'sign' ? Math.abs(ticks) : Math.abs(ticks) ^ (1 << Number(bit));
    applyValue(id, sign && magnitude ? -magnitude : magnitude, sign && magnitude === 0);
    $('nodes').querySelector(`[data-node="${id}"] [data-bit="${bit}"]`).focus({ preventScroll: true });
  }

  function fitZoom() {
    return Math.min(1, Math.max(0.7, ($('board-scroll').clientWidth - 2) / width));
  }

  function setZoom(next, fit = false) {
    zoom = Math.max(0.7, Math.min(1.6, next));
    autoZoom = fit;
    $('stage').style.width = `${width * zoom}px`;
    $('stage').style.height = `${height * zoom}px`;
    $('plane').style.transform = `scale(${zoom})`;
    $('zoom-fit').textContent = `${Math.round(zoom * 100)}%`;
    $('zoom-out').disabled = zoom <= 0.7;
    $('zoom-in').disabled = zoom >= 1.6;
  }

  function planePoint(event) {
    const rect = $('plane').getBoundingClientRect();
    return { x: (event.clientX - rect.left) / zoom, y: (event.clientY - rect.top) / zoom };
  }

  $('nodes').addEventListener('click', event => {
    const target = event.target.closest('button');
    if (!target) return;
    const id = target.closest('[data-node]').dataset.node;
    if (target.hasAttribute('data-out')) activateOutlet(id);
    else if (target.hasAttribute('data-in')) {
      if (source) completeWire(source, id, target.dataset.in);
      else hint('先选择要接出的输出圆点。', true);
    } else if (target.hasAttribute('data-bit')) toggleInputBit(id, target.dataset.bit);
    else if (target.hasAttribute('data-edit')) showEditor(id);
    else if (target.classList.contains('node-head')) {
      select({ kind: 'node', id });
      $('nodes').querySelector(`[data-node="${id}"] .node-head`).focus({ preventScroll: true });
    }
  });

  $('nodes').addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    const grip = event.target.closest('.node-head, [data-out]');
    if (!grip) return;
    const element = grip.closest('[data-node]');
    const id = element.dataset.node;
    const base = graph.nodes.find(item => item.id === id);
    const start = planePoint(event);
    if (grip.hasAttribute('data-out')) wireDrag = { id, grip, start, pointer: event.pointerId, moved: false };
    else drag = { base, element, grip, start, pointer: event.pointerId, moved: false };
    grip.setPointerCapture(event.pointerId);
  });

  $('nodes').addEventListener('pointermove', event => {
    const active = drag || wireDrag;
    if (!active || active.pointer !== event.pointerId) return;
    const end = planePoint(event);
    const dx = end.x - active.start.x;
    const dy = end.y - active.start.y;
    if (!active.moved && Math.hypot(dx, dy) < 5) return;
    active.moved = true;
    if (wireDrag) {
      wireDrag.end = end;
      renderWires();
      return;
    }
    const x = Math.round(Math.max(16, Math.min(width - 190, drag.base.x + dx)));
    const y = Math.round(Math.max(47, Math.min(height - drag.element.offsetHeight - 14, drag.base.y + dy)));
    drag.next = { ...drag.base, x, y };
    drag.element.style.left = `${x}px`;
    drag.element.style.top = `${y}px`;
    // Use the live position for drawing while retaining the original graph for undo.
    const savedGraph = graph;
    graph = { ...graph, nodes: graph.nodes.map(item => item.id === drag.base.id ? drag.next : item) };
    renderWires();
    graph = savedGraph;
  });

  function endPointer(event) {
    const active = drag || wireDrag;
    if (!active || active.pointer !== event.pointerId) return;
    const moving = drag;
    drag = null;
    wireDrag = null;
    if (!active.moved) return;
    if (event.type === 'pointercancel') return render();
    if (moving) {
      selection = { kind: 'node', id: moving.base.id };
      commit({ ...graph, nodes: graph.nodes.map(item => item.id === moving.base.id ? moving.next : item) }, '已移动节点。');
    } else {
      const port = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-in]');
      if (port) completeWire(active.id, port.closest('[data-node]').dataset.node, port.dataset.in);
      renderWires();
    }
  }

  $('nodes').addEventListener('pointerup', endPointer);
  $('nodes').addEventListener('pointercancel', endPointer);
  $('plane').addEventListener('click', event => {
    const trace = event.target.closest('[data-wire]');
    if (trace) select({ kind: 'wire', index: Number(trace.dataset.wire) });
    else if (event.target === $('plane')) select(null);
  });

  $('plane').addEventListener('contextmenu', event => {
    const port = event.target.closest('[data-in]');
    const trace = event.target.closest('[data-wire]');
    const item = event.target.closest('[data-node]');
    if (!port && !trace && !item) return;
    event.preventDefault();
    if (port || trace) {
      const index = trace ? Number(trace.dataset.wire) : graph.wires.findIndex(w => w.to === item.dataset.node && w.port === port.dataset.in);
      if (index < 0) return;
      selection = { kind: 'wire', index };
    } else {
      selection = { kind: 'node', id: item.dataset.node };
    }
    removeSelected();
    updateToolbar();
  });

  $('inspection-content').addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.hasAttribute('data-case')) {
      currentCase = Number(button.dataset.case);
      sampleValues = {};
      render();
      document.querySelector(`[data-case="${currentCase}"]`).focus({ preventScroll: true });
    } else if (button.id === 'check') {
      sampleValues = {};
      const { cases } = levels[levelIndex];
      results = cases.map((values, i) => evaluate(graph, caseInputs(i)).get('y')?.ticks === parse(values.at(-1)));
      const firstFailure = results.indexOf(false);
      if (firstFailure >= 0) currentCase = firstFailure;
      else {
        passed[levelIndex] = true;
        persist();
      }
      render();
      $('check').focus({ preventScroll: true });
      hint(firstFailure >= 0 ? `样例 ${firstFailure + 1} 的结果与目标不同。` : '本关的所有样例均通过。', firstFailure >= 0);
    }
  });

  document.querySelectorAll('[data-part]').forEach(button => button.addEventListener('click', () => addPart(button.dataset.part)));
  document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => $(button.dataset.close).close()));
  $('help').addEventListener('click', () => $('help-dialog').showModal());
  $('challenge').addEventListener('click', () => switchBoard(false));
  $('sandbox').addEventListener('click', () => switchBoard(true));
  $('prev').addEventListener('click', () => switchBoard(false, levelIndex - 1));
  $('next').addEventListener('click', () => switchBoard(false, levelIndex + 1));
  $('levels').addEventListener('change', () => switchBoard(false, Number($('levels').value)));
  $('undo').addEventListener('click', () => travel(undo, redo, '已撤销。'));
  $('redo').addEventListener('click', () => travel(redo, undo, '已重做。'));
  $('delete').addEventListener('click', removeSelected);
  $('step').addEventListener('click', () => {
    delays = advance(graph, liveInputs(), delays);
    tick += 1;
    results = null;
    render();
    hint(`第 ${tick} 步。所有延迟线已同时采样。`);
  });
  $('reset').addEventListener('click', () => {
    selection = null;
    sampleValues = {};
    delays = {};
    tick = 0;
    commit(starter(), '已重置电路，可以撤销。');
  });
  $('zoom-out').addEventListener('click', () => setZoom(zoom - 0.15));
  $('zoom-fit').addEventListener('click', () => setZoom(fitZoom(), true));
  $('zoom-in').addEventListener('click', () => setZoom(zoom + 0.15));
  new ResizeObserver(() => { if (autoZoom) setZoom(fitZoom(), true); }).observe($('board-scroll'));

  $('value-form').addEventListener('submit', event => {
    event.preventDefault();
    try {
      const raw = $('value-input').value.trim();
      const ticks = parse(raw);
      $('value-dialog').close();
      applyValue(editedId, ticks, ticks === 0 && raw.startsWith('-'));
      $('nodes').querySelector(`[data-node="${editedId}"] [data-edit]`).focus({ preventScroll: true });
    } catch (error) {
      $('value-error').textContent = error.message;
    }
  });

  document.addEventListener('keydown', event => {
    if (event.target.matches('input, select') || document.querySelector('dialog[open]')) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) travel(redo, undo, '已重做。');
      else travel(undo, redo, '已撤销。');
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      removeSelected();
    } else if (event.key === 'Escape') select(null);
  });

  if (!save.inputPanel) persist();
  render();
  setZoom(fitZoom(), true);
})();
