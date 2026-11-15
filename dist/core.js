(function (root) {
  'use strict';

  const integerBits = 4;
  const fractionBits = 4;
  const scale = 2 ** fractionBits;
  const max = 2 ** (integerBits + fractionBits) - 1;
  const ports = Object.freeze({ input: [], constant: [], add: ['A', 'B'], left: ['A', 'N'], right: ['A', 'N'], output: ['IN'] });

  function format(ticks) {
    return String(ticks / scale);
  }

  function parse(value) {
    const source = String(value).trim();
    const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))$/.exec(source);
    if (!match || source.length > 40) throw new Error('请输入十进制数值。');
    const decimal = match[3] || match[4] || '';
    const denominator = 10n ** BigInt(decimal.length);
    const numerator = (BigInt(match[2] || 0) * denominator + BigInt(decimal || 0)) * BigInt(scale);
    if (numerator > BigInt(max) * denominator) throw new Error('数值范围为 −15.9375 至 +15.9375。');
    if (numerator % denominator) throw new Error('请输入 0.0625 的整数倍。');
    const ticks = Number(numerator / denominator);
    return match[1] === '-' && ticks !== 0 ? -ticks : ticks;
  }

  function bits(ticks) {
    const magnitude = Math.abs(ticks).toString(2).padStart(integerBits + fractionBits, '0');
    return [ticks < 0 ? '−' : '+', magnitude.slice(0, integerBits), magnitude.slice(integerBits)];
  }

  function operate(type, a, b) {
    let result;
    if (type === 'add') {
      result = a + b;
    } else {
      if (b < 0 || b % scale !== 0) throw new Error('移位量 N 必须是非负整数，小数位须为 0000。');
      const factor = 2 ** (b / scale);
      result = type === 'left' ? a * factor : Math.trunc(a / factor);
    }
    if (Math.abs(result) > max) throw new Error('运算溢出，结果超出固定位宽。');
    return result || 0;
  }

  function evaluate(graph, inputs = {}) {
    const nodes = new Map(graph.nodes.map(node => [node.id, node]));
    const wires = new Map(graph.wires.map(wire => [`${wire.to}:${wire.port}`, wire.from]));
    const values = new Map();
    const visiting = new Set();

    function resolve(id) {
      if (values.has(id)) return values.get(id);
      if (visiting.has(id)) return { error: '电路中存在循环连接。', origin: id };
      const node = nodes.get(id);
      if (!node) return { error: '连接的元件已移除。', origin: id };
      visiting.add(id);
      let value;
      try {
        if (node.type === 'input' || node.type === 'constant') {
          value = { ticks: node.type === 'input' && Object.hasOwn(inputs, id) ? inputs[id] : node.ticks };
        } else {
          const args = ports[node.type].map(port => {
            const source = wires.get(`${id}:${port}`);
            return source ? resolve(source) : { error: `端口 ${port} 还未接线。`, origin: id };
          });
          value = args.find(arg => arg.error);
          if (!value) value = { ticks: node.type === 'output' ? args[0].ticks : operate(node.type, args[0].ticks, args[1].ticks) };
        }
      } catch (error) {
        value = { error: error.message, origin: id };
      }
      visiting.delete(id);
      values.set(id, value);
      return value;
    }

    for (const node of graph.nodes) resolve(node.id);
    return values;
  }

  function connect(graph, from, to, port) {
    const source = graph.nodes.find(node => node.id === from);
    const target = graph.nodes.find(node => node.id === to);
    if (!source || !target || source.type === 'output' || !ports[target.type].includes(port)) {
      throw new Error('请把输出端连接到输入端。');
    }
    const wires = graph.wires.filter(wire => wire.to !== to || wire.port !== port);
    const visited = new Set();
    const pending = [to];
    while (pending.length) {
      const id = pending.pop();
      if (id === from) throw new Error('这条线会形成循环连接。');
      if (visited.has(id)) continue;
      visited.add(id);
      for (const wire of wires) if (wire.from === id) pending.push(wire.to);
    }
    wires.push({ from, to, port });
    return { ...graph, wires };
  }

  const core = { integerBits, fractionBits, scale, max, ports, format, parse, bits, operate, evaluate, connect };
  if (typeof module === 'object' && module.exports) module.exports = core;
  else root.FixedPoint = core;
})(globalThis);
