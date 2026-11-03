import type { CustomColumn, Task } from './domain.ts'

type Value = number | string | boolean
type Node =
  | { kind: 'value'; value: Value }
  | { kind: 'ref'; id: string }
  | { kind: 'op'; op: string; args: Node[] }
  | { kind: 'call'; name: string; args: Node[] }
type Token = { kind: string; raw: string; value: string }
export class FormulaError extends Error {
  constructor(
    message: string,
    public code = '#ERRO!',
  ) {
    super(message)
  }
}
const functions: Record<string, { name: string; min: number; max: number }> = {}
for (const [names, min, max] of [
  ['SOMA,SUM', 1, 40],
  ['MEDIA,MÉDIA,AVERAGE', 1, 40],
  ['MIN,MINIMO,MÍNIMO', 1, 40],
  ['MAX,MAXIMO,MÁXIMO', 1, 40],
  ['SE,IF', 3, 3],
  ['SEERRO,IFERROR', 2, 2],
  ['ARRED,ROUND', 1, 2],
  ['ABS', 1, 1],
  ['E,AND', 1, 40],
  ['OU,OR', 1, 40],
  ['CONCAT,CONCATENAR', 1, 40],
] as const) {
  const aliases = names.split(',')
  for (const alias of aliases) functions[alias] = { name: aliases[0], min, max }
}
function tokenize(source: string): Token[] {
  const text = source.trim().replace(/^=/, '')
  if (!text || text.length > 20000) throw new FormulaError('Informe uma fórmula válida.')
  const tokens: Token[] = []
  let index = 0
  while (index < text.length) {
    const rest = text.slice(index)
    if (/^\s/.test(rest)) {
      index++
      continue
    }
    const match =
      /^(?:\{([^{}]+)\}|"((?:[^"]|"")*)"|(\d+(?:\.\d*)?|\.\d+)(?:([eE][+-]?\d+))?|([\p{L}_][\p{L}\d_]*)|(<>|!=|>=|<=|[+\-*/^%=<>&();,]))/u.exec(
        rest,
      )
    if (!match) throw new FormulaError(`Trecho não reconhecido: “${rest.slice(0, 20)}”.`)
    const kind =
      match[1] !== undefined
        ? 'ref'
        : match[2] !== undefined
          ? 'string'
          : match[3] !== undefined
            ? 'number'
            : match[5]
              ? 'name'
              : 'symbol'
    tokens.push({
      kind,
      raw: match[0],
      value:
        match[1]?.trim() ??
        match[2]?.replaceAll('""', '"') ??
        (match[3] ? match[3] + (match[4] || '') : match[5] || match[6]),
    })
    index += match[0].length
    if (tokens.length > 512) throw new FormulaError('A fórmula é muito longa.')
  }
  return tokens
}
function resolveReference(value: string, columns: CustomColumn[]): string {
  const matches = value.startsWith('#')
    ? columns.filter((c) => c.id === value.slice(1))
    : columns.filter((c) => c.name.toLocaleLowerCase('pt-BR') === value.toLocaleLowerCase('pt-BR'))
  if (matches.length !== 1)
    throw new FormulaError(
      matches.length
        ? `O nome “${value}” é ambíguo. Use o botão da coluna para inserir a referência.`
        : `A coluna “${value}” não existe.`,
      '#REF!',
    )
  if (['files', 'people', 'dropdown'].includes(matches[0].type))
    throw new FormulaError(`A coluna “${matches[0].name}” não pode ser usada neste cálculo.`)
  return matches[0].id
}
function parse(tokens: Token[], columns: CustomColumn[]): Node {
  let index = 0
  const peek = () => tokens[index]?.value
  const take = (value: string) => {
    if (peek() === value) {
      index++
      return true
    }
    return false
  }
  const need = (value: string) => {
    if (!take(value)) throw new FormulaError(`Esperado “${value}”.`)
  }
  const precedence: Record<string, number> = {
    '=': 1,
    '!=': 1,
    '<>': 1,
    '>': 1,
    '<': 1,
    '>=': 1,
    '<=': 1,
    '&': 2,
    '+': 3,
    '-': 3,
    '*': 4,
    '/': 4,
    '^': 5,
  }
  function expression(min = 0, depth = 0): Node {
    if (depth > 32) throw new FormulaError('A fórmula tem muitos níveis de parênteses.')
    let node: Node
    const token = tokens[index++]
    if (!token) throw new FormulaError('A fórmula está incompleta.')
    if (token.kind === 'number') node = { kind: 'value', value: Number(token.value) }
    else if (token.kind === 'string') node = { kind: 'value', value: token.value }
    else if (token.kind === 'ref')
      node = { kind: 'ref', id: resolveReference(token.value, columns) }
    else if (token.value === '(') {
      node = expression(0, depth + 1)
      need(')')
    } else if (['+', '-'].includes(token.value))
      node = {
        kind: 'op',
        op: token.value === '-' ? 'negate' : 'positive',
        args: [expression(5, depth + 1)],
      }
    else if (token.kind === 'name') {
      const name = token.value.toLocaleUpperCase('pt-BR')
      if (['VERDADEIRO', 'TRUE', 'FALSO', 'FALSE'].includes(name))
        node = { kind: 'value', value: ['VERDADEIRO', 'TRUE'].includes(name) }
      else {
        const fn = functions[name]
        if (!fn) throw new FormulaError(`Função “${name}” não disponível.`)
        need('(')
        const args: Node[] = []
        if (!take(')')) {
          do {
            args.push(expression(0, depth + 1))
          } while (take(';') || take(','))
          need(')')
        }
        if (args.length < fn.min || args.length > fn.max)
          throw new FormulaError(`Confira a quantidade de argumentos de ${name}.`)
        node = { kind: 'call', name: fn.name, args }
      }
    } else throw new FormulaError(`Símbolo inesperado: “${token.value}”.`)
    while (take('%')) node = { kind: 'op', op: '%', args: [node] }
    while (peek() && (precedence[peek()] ?? -1) >= min) {
      const op = tokens[index++].value
      node = {
        kind: 'op',
        op,
        args: [node, expression(precedence[op] + Number(op !== '^'), depth + 1)],
      }
    }
    return node
  }
  const node = expression()
  if (index !== tokens.length)
    throw new FormulaError(
      'Confira os operadores e separadores da fórmula. Use ponto nos decimais e ponto e vírgula entre argumentos.',
    )
  return node
}
export function compileFormula(source: string, columns: CustomColumn[]): string {
  if (source.length > 2000) throw new FormulaError('A fórmula permite até 2.000 caracteres.')
  const tokens = tokenize(source)
  parse(tokens, columns)
  return tokens
    .map((t) => (t.kind === 'ref' ? `{#${resolveReference(t.value, columns)}}` : t.raw))
    .join(' ')
}
export function formulaReference(column: CustomColumn, columns: CustomColumn[]) {
  const unique =
    columns.filter(
      (c) => c.name.toLocaleLowerCase('pt-BR') === column.name.toLocaleLowerCase('pt-BR'),
    ).length === 1
  return `{${unique && !/[{}]/.test(column.name) && !column.name.startsWith('#') ? column.name : '#' + column.id}}`
}
export function displayFormula(source: string, columns: CustomColumn[]): string {
  try {
    return tokenize(source)
      .map((t) => {
        if (t.kind !== 'ref') return t.raw
        const column = columns.find((c) => c.id === t.value.replace(/^#/, ''))
        return column ? formulaReference(column, columns) : t.raw
      })
      .join(' ')
  } catch {
    return source
  }
}
export function validateFormulaCycles(columns: CustomColumn[]) {
  const complete = new Set<string>()
  function visit(id: string, path: Set<string>) {
    if (complete.has(id)) return
    const column = columns.find((c) => c.id === id)
    if (column?.type !== 'formula' || !column.formula) return
    if (path.has(id)) throw new FormulaError('A fórmula cria uma referência circular.', '#CICLO!')
    const next = new Set(path).add(id)
    for (const ref of tokenize(column.formula).filter((t) => t.kind === 'ref'))
      visit(ref.value.replace(/^#/, ''), next)
    complete.add(id)
  }
  for (const column of columns) visit(column.id, new Set())
}
function number(value: Value) {
  if (typeof value === 'number') return value
  if (typeof value === 'boolean') return Number(value)
  if (value.trim() === '') return 0
  const result = Number(value.trim().replace(',', '.'))
  if (!Number.isFinite(result)) throw new FormulaError('Um dos valores não é um número.', '#VALOR!')
  return result
}
export function evaluateFormula(
  column: CustomColumn,
  columns: CustomColumn[],
  task: Task,
): { value: Value | null; error?: string; code?: string } {
  try {
    const active = new Set<string>()
    const computed = new Map<string, Value>()
    let budget = 5000
    function calculate(id: string): Value {
      if (computed.has(id)) return computed.get(id)!
      if (active.has(id)) throw new FormulaError('Referência circular.', '#CICLO!')
      const field = columns.find((c) => c.id === id)
      if (!field) throw new FormulaError('Uma coluna usada na fórmula foi excluída.', '#REF!')
      if (field.type === 'formula') {
        active.add(id)
        try {
          const result = run(parse(tokenize(field.formula || ''), columns))
          if (typeof result === 'number' && !Number.isFinite(result))
            throw new FormulaError('O resultado não é um número finito.', '#NÚM!')
          computed.set(id, result)
          return result
        } finally {
          active.delete(id)
        }
      }
      if (field.type === 'number') return number(task.customValues[id] || '')
      return id === 'title'
        ? task.title
        : id === 'status'
          ? task.status
          : id === 'priority'
            ? task.priority
            : id === 'date'
              ? task.dueDate || ''
              : task.customValues[id] || ''
    }
    function run(node: Node): Value {
      if (--budget < 0) throw new FormulaError('O cálculo excedeu o limite de operações.')
      const value = compute(node)
      if (typeof value === 'string' && value.length > 10000)
        throw new FormulaError('O resultado excede o limite de 10.000 caracteres.', '#VALOR!')
      if (typeof value === 'number' && !Number.isFinite(value))
        throw new FormulaError('O resultado não é um número finito.', '#NÚM!')
      return value
    }
    function compute(node: Node): Value {
      if (node.kind === 'value') return node.value
      if (node.kind === 'ref') return calculate(node.id)
      if (node.kind === 'call') {
        if (node.name === 'SE') return run(node.args[Number(!run(node.args[0])) + 1])
        if (node.name === 'SEERRO') {
          try {
            return run(node.args[0])
          } catch (e) {
            if (!(e instanceof FormulaError)) throw e
            return run(node.args[1])
          }
        }
        const values = node.args.map(run)
        if (node.name === 'CONCAT') return values.join('')
        if (node.name === 'E') return values.every(Boolean)
        if (node.name === 'OU') return values.some(Boolean)
        const numbers = values.map(number)
        if (node.name === 'SOMA') return numbers.reduce((a, b) => a + b, 0)
        if (node.name === 'MEDIA') return numbers.reduce((a, b) => a + b, 0) / numbers.length
        if (node.name === 'MIN') return Math.min(...numbers)
        if (node.name === 'MAX') return Math.max(...numbers)
        if (node.name === 'ABS') return Math.abs(numbers[0])
        const places = numbers[1] ?? 0
        if (!Number.isInteger(places) || Math.abs(places) > 12)
          throw new FormulaError('ARRED aceita de -12 a 12 casas decimais.')
        const factor = 10 ** places
        return (
          (Math.sign(numbers[0]) * Math.round((Math.abs(numbers[0]) + Number.EPSILON) * factor)) /
          factor
        )
      }
      const a = run(node.args[0])
      if (node.op === 'negate') return -number(a)
      if (node.op === 'positive') return number(a)
      if (node.op === '%') return number(a) / 100
      const b = run(node.args[1])
      if (node.op === '&') return String(a) + String(b)
      if (['=', '!=', '<>'].includes(node.op)) {
        const equal =
          typeof a === typeof b
            ? String(a).toLocaleLowerCase('pt-BR') === String(b).toLocaleLowerCase('pt-BR')
            : Number.isFinite(Number(a)) && Number.isFinite(Number(b)) && Number(a) === Number(b)
        return node.op === '=' ? equal : !equal
      }
      const x = number(a),
        y = number(b)
      if (node.op === '>') return x > y
      if (node.op === '<') return x < y
      if (node.op === '>=') return x >= y
      if (node.op === '<=') return x <= y
      if (node.op === '+') return x + y
      if (node.op === '-') return x - y
      if (node.op === '*') return x * y
      if (node.op === '^') return x ** y
      if (y === 0) throw new FormulaError('Divisão por zero.', '#DIV/0!')
      return x / y
    }
    const value = calculate(column.id)
    if (typeof value === 'number' && !Number.isFinite(value))
      throw new FormulaError('O resultado não é um número finito.', '#NÚM!')
    return { value }
  } catch (e) {
    return {
      value: null,
      error: e instanceof Error ? e.message : 'Não foi possível calcular.',
      code: e instanceof FormulaError ? e.code : '#ERRO!',
    }
  }
}
export function formulaText(result: ReturnType<typeof evaluateFormula>): string {
  return result.error
    ? result.code || '#ERRO!'
    : typeof result.value === 'number'
      ? new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 10 }).format(result.value)
      : typeof result.value === 'boolean'
        ? result.value
          ? 'VERDADEIRO'
          : 'FALSO'
        : String(result.value ?? '')
}
