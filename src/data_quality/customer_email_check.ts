export type EmailNameCheckResult = {
    status: "ok" | "warning" | "not_checked";
    message?: string;
  };
  
  function normalise(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]/g, "");
  }
  
  function getLocalPart(email: string): string {
    return email.split("@")[0] ?? "";
  }
  
  function isGenericEmail(localPart: string): boolean {
    return [
      "info",
      "hello",
      "admin",
      "accounts",
      "account",
      "sales",
      "support",
      "office",
      "contact",
      "enquiries",
      "billing",
      "finance",
    ].includes(localPart);
  }
  
  export function checkCustomerNameEmailMatch(args: {
    name?: unknown;
    email?: unknown;
  }): EmailNameCheckResult {
    if (typeof args.name !== "string" || typeof args.email !== "string") {
      return { status: "not_checked" };
    }
  
    const name = args.name.trim();
    const email = args.email.trim();
  
    if (!name || !email.includes("@")) {
      return { status: "not_checked" };
    }
  
    const localPart = normalise(getLocalPart(email));
  
    if (!localPart || isGenericEmail(localPart)) {
      return { status: "ok" };
    }
  
    const nameParts = name
      .toLowerCase()
      .split(/[^a-z0-9]+/i)
      .filter(Boolean);
  
    if (nameParts.length === 0) {
      return { status: "not_checked" };
    }
  
    const firstName = normalise(nameParts[0] ?? "");
    const lastName = normalise(nameParts[nameParts.length - 1] ?? "");
    const fullName = normalise(name);
    const firstInitialSurname = `${firstName[0] ?? ""}${lastName}`;
  
    const plausible = [
      fullName,
      `${firstName}${lastName}`,
      firstInitialSurname,
      `${firstName}${lastName[0] ?? ""}`,
    ];
  
    if (
      plausible.includes(localPart) ||
      localPart.includes(`${firstName}${lastName}`) ||
      localPart.includes(firstInitialSurname)
    ) {
      return { status: "ok" };
    }
  
    return {
      status: "warning",
      message: `Possible email/name mismatch: the customer name is "${name}", but the email address is "${email}". Please confirm this email belongs to the customer before saving.`,
    };
  }