export type Item = {sku: string; quantity: number; unitPriceCents: number};
export type Customer = {kind: 'email' | 'id'; value: string};
export type CanonicalOrder = {
  eventId: string; eventType: 'order.placed'; schemaVersion: 3; occurredAt: string;
  payload: {orderId: string; customer: Customer; currency: string; totalCents: number; items: Item[] | null};
};

type ObjectValue = Record<string, unknown>;
function object(value: unknown, label: string): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as ObjectValue;
}
function keys(value: ObjectValue, expected: string[], label: string): void {
  if (Object.keys(value).some(key => !expected.includes(key)) || expected.some(key => !Object.hasOwn(value, key))) throw new Error(`${label} has missing or unknown fields`);
}
function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) throw new Error(`${label} must contain 1-200 characters`);
  return value;
}
function integer(value: unknown, label: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) throw new Error(`${label} must be a safe integer >= ${minimum}`);
  return value;
}
function items(value: unknown): Item[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10000) throw new Error('items must contain 1-10000 lines');
  return value.map((entry: unknown) => {
    const item = object(entry, 'item'); keys(item, ['sku','quantity','unitPriceCents'], 'item');
    return {sku: text(item.sku, 'sku'), quantity: integer(item.quantity, 'quantity', 1), unitPriceCents: integer(item.unitPriceCents, 'unitPriceCents')};
  });
}
function total(lines: Item[]): number {
  const sum = lines.reduce((sum, item) => sum + BigInt(item.quantity) * BigInt(item.unitPriceCents), 0n);
  if (sum > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('order total exceeds safe integer range');
  return Number(sum);
}

export function upcast(input: unknown): CanonicalOrder {
  const event = object(input, 'event');
  keys(event, ['eventId','eventType','schemaVersion','occurredAt','payload'], 'event');
  const eventId = text(event.eventId, 'eventId');
  if (event.eventType !== 'order.placed') throw new Error('unsupported eventType');
  if (![1,2,3].includes(event.schemaVersion as number)) throw new Error('unsupported schemaVersion');
  const occurredAt = text(event.occurredAt, 'occurredAt');
  // A canonical UTC form makes validation independent of locale and DST rules.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(occurredAt) || !Number.isFinite(Date.parse(occurredAt)) || new Date(occurredAt).toISOString() !== occurredAt) throw new Error('occurredAt must be a valid UTC ISO timestamp with milliseconds');
  const payload = object(event.payload, 'payload');
  let customer: Customer, orderItems: Item[] | null, totalCents: number;
  if (event.schemaVersion === 1) {
    keys(payload, ['orderId','customerEmail','currency','totalCents'], 'v1 payload');
    const email = text(payload.customerEmail, 'customerEmail');
    if (!/^[^\s@]+@[^\s@]+$/.test(email)) throw new Error('invalid customerEmail shape');
    customer = {kind: 'email', value: email};
    orderItems = null; // v1 never supplied line items; inventing them would lose provenance.
    totalCents = integer(payload.totalCents, 'totalCents');
  } else if (event.schemaVersion === 2) {
    keys(payload, ['orderId','customerId','currency','items'], 'v2 payload');
    customer = {kind: 'id', value: text(payload.customerId, 'customerId')};
    orderItems = items(payload.items); totalCents = total(orderItems);
  } else {
    keys(payload, ['orderId','customer','currency','totalCents','items'], 'v3 payload');
    const original = object(payload.customer, 'customer'); keys(original, ['kind','value'], 'customer');
    if (original.kind !== 'email' && original.kind !== 'id') throw new Error('invalid customer kind');
    customer = {kind: original.kind, value: text(original.value, 'customer value')};
    if (customer.kind === 'email' && !/^[^\s@]+@[^\s@]+$/.test(customer.value)) throw new Error('invalid customer email shape');
    orderItems = payload.items === null ? null : items(payload.items);
    totalCents = integer(payload.totalCents, 'totalCents');
    if (orderItems !== null && total(orderItems) !== totalCents) throw new Error('totalCents does not match line items');
  }
  if (typeof payload.currency !== 'string' || !/^[A-Z]{3}$/.test(payload.currency)) throw new Error('currency must be a three-letter uppercase code');
  return {eventId, eventType:'order.placed', schemaVersion:3, occurredAt, payload:{orderId:text(payload.orderId, 'orderId'), customer, currency:payload.currency, totalCents, items:orderItems}};
}

export class EventStream {
  private readonly seen = new Map<string, string>();
  constructor(private readonly maximumIds = 100000) {
    if (!Number.isSafeInteger(maximumIds) || maximumIds < 1) throw new Error('maximumIds must be positive');
  }
  accept(value: unknown): CanonicalOrder | null {
    const event = upcast(value), serialized = JSON.stringify(event);
    const prior = this.seen.get(event.eventId);
    if (prior !== undefined) {
      if (prior !== serialized) throw new Error('conflicting content for an existing eventId');
      return null;
    }
    if (this.seen.size >= this.maximumIds) throw new Error('event ID capacity exceeded');
    this.seen.set(event.eventId, serialized);
    return event;
  }
}
