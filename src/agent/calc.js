/* ─── 安全表达式计算器 ───
 * 递归下降解析，不使用 eval / new Function。
 * 支持 + - * / % ^ 、括号、函数（sqrt/abs/log/sin/cos/tan/exp/min/max/round/floor/ceil/pow）、常量 pi/e。
 */

const FUNCTIONS = {
  sqrt: Math.sqrt, abs: Math.abs, log: Math.log, log2: Math.log2, log10: Math.log10,
  exp: Math.exp, sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin,
  acos: Math.acos, atan: Math.atan, round: Math.round, floor: Math.floor, ceil: Math.ceil,
  sign: Math.sign, trunc: Math.trunc,
};
const CONSTANTS = { pi: Math.PI, e: Math.E, tau: Math.PI * 2 };

export function evaluateExpression(expr) {
  const src = String(expr || '').trim();
  if (!src) throw new Error('表达式为空');
  if (src.length > 500) throw new Error('表达式过长');
  if (/[a-zA-Z_$]/.test(src.replace(/sqrt|abs|log2|log10|log|exp|sin|cos|tan|asin|acos|atan|round|floor|ceil|sign|trunc|min|max|pow|pi|tau|e/gi, ''))) {
    throw new Error('表达式包含不支持的标识符');
  }
  const parser = new Parser(src);
  const value = parser.parseExpression();
  parser.skipWs();
  if (parser.pos < parser.src.length) throw new Error(`表达式在第 ${parser.pos + 1} 个字符处无法解析`);
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error('计算结果不是有限数');
  }
  return value;
}

class Parser {
  constructor(src) { this.src = src; this.pos = 0; }

  skipWs() { while (this.pos < this.src.length && /\s/.test(this.src[this.pos])) this.pos++; }

  peek() { this.skipWs(); return this.src[this.pos]; }

  eat(ch) {
    this.skipWs();
    if (this.src[this.pos] === ch) { this.pos++; return true; }
    return false;
  }

  parseExpression() { return this.parseAddSub(); }

  parseAddSub() {
    let left = this.parseMulDiv();
    for (;;) {
      const c = this.peek();
      if (c === '+') { this.pos++; left += this.parseMulDiv(); }
      else if (c === '-') { this.pos++; left -= this.parseMulDiv(); }
      else return left;
    }
  }

  parseMulDiv() {
    let left = this.parseUnary();
    for (;;) {
      const c = this.peek();
      if (c === '*') { this.pos++; left *= this.parseUnary(); }
      else if (c === '/') { this.pos++; const r = this.parseUnary(); left = r === 0 ? NaN : left / r; }
      else if (c === '%') { this.pos++; const r = this.parseUnary(); left = r === 0 ? NaN : left % r; }
      else return left;
    }
  }

  parseUnary() {
    const c = this.peek();
    if (c === '-') { this.pos++; return -this.parseUnary(); }
    if (c === '+') { this.pos++; return this.parseUnary(); }
    return this.parsePower();
  }

  parsePower() {
    const base = this.parsePrimary();
    if (this.peek() === '^') {
      this.pos++;
      const exp = this.parseUnary();
      return Math.pow(base, exp);
    }
    return base;
  }

  parsePrimary() {
    this.skipWs();
    const c = this.src[this.pos];
    if (c === '(') {
      this.pos++;
      const v = this.parseExpression();
      if (!this.eat(')')) throw new Error('缺少右括号');
      return v;
    }
    if (/[0-9.]/.test(c)) {
      const start = this.pos;
      while (this.pos < this.src.length && /[0-9._]/.test(this.src[this.pos])) this.pos++;
      const num = parseFloat(this.src.slice(start, this.pos).replace(/_/g, ''));
      if (Number.isNaN(num)) throw new Error(`无法解析数字：${this.src.slice(start, this.pos)}`);
      return num;
    }
    if (/[a-zA-Z]/.test(c)) {
      const start = this.pos;
      while (this.pos < this.src.length && /[a-zA-Z0-9_]/.test(this.src[this.pos])) this.pos++;
      const name = this.src.slice(start, this.pos);
      const lower = name.toLowerCase();
      if (lower in CONSTANTS) return CONSTANTS[lower];
      if (lower in FUNCTIONS) {
        if (!this.eat('(')) throw new Error(`函数 ${name} 缺少括号`);
        const args = [];
        if (this.peek() !== ')') {
          do { args.push(this.parseExpression()); } while (this.eat(','));
        }
        if (!this.eat(')')) throw new Error(`函数 ${name} 缺少右括号`);
        const fn = FUNCTIONS[lower];
        if (fn.length > 1) return fn(...args);
        return fn(args[0]);
      }
      if (lower === 'min' || lower === 'max') {
        if (!this.eat('(')) throw new Error(`函数 ${name} 缺少括号`);
        const args = [];
        if (this.peek() !== ')') {
          do { args.push(this.parseExpression()); } while (this.eat(','));
        }
        if (!this.eat(')')) throw new Error(`函数 ${name} 缺少右括号`);
        return lower === 'min' ? Math.min(...args) : Math.max(...args);
      }
      if (lower === 'pow') {
        if (!this.eat('(')) throw new Error('pow 缺少括号');
        const a = this.parseExpression();
        if (!this.eat(',')) throw new Error('pow 参数错误');
        const b = this.parseExpression();
        if (!this.eat(')')) throw new Error('pow 缺少右括号');
        return Math.pow(a, b);
      }
      throw new Error(`未知标识符：${name}`);
    }
    throw new Error(`无法解析的字符：${c ?? 'EOF'}`);
  }
}
