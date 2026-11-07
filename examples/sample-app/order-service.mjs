/** Camada de serviço do exemplo: regras de negócio de pedidos. */

export function calculateTotal(items) {
  let sum = 0;
  for (const item of items) {
    sum += item.price * item.quantity;
  }
  return sum;
}

export class OrderService {
  constructor(db) {
    this.db = db;
  }

  async create(customer, items, couponCode) {
    let total = calculateTotal(items);

    if (couponCode === "WELCOME10") total = total * 0.9;

    if (total > customer.creditLimit) {
      throw new Error("Limite de crédito excedido");
    }

    const order = await this.db.insert("orders", {
      customerId: customer.id,
      items,
      total,
    });
    return order;
  }
}
