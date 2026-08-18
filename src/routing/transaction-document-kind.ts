export type TransactionDocumentKind =
  | "cash_receipt"
  | "cash_payment"
  | "cheques_entry"
  | "purchase"
  | "sales_entry"
  | "unknown";

export type BookTranType = {
  id: number;
  description: string;
  code?: string;
};

export function resolveTransactionDocumentKind(
  bookTranTypeId: number,
  bookTranTypes: BookTranType[]
): TransactionDocumentKind {
  const match = bookTranTypes.find(
    (item) => item.id === bookTranTypeId
  );

  if (!match) {
    return "unknown";
  }

  const description =
    match.description.trim().toLowerCase();

  switch (description) {
    case "cash receipt":
      return "cash_receipt";

    case "cash payment":
      return "cash_payment";

    case "cheques entry":
      return "cheques_entry";

    case "purchases book entry":
      return "purchase";

    case "sales entry":
      return "sales_entry";

    default:
      return "unknown";
  }
}