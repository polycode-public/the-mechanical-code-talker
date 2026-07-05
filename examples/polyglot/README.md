# Example: polyglot

A ready-made code graph that demonstrates tmct's **language-neutral** idea: code
entities extracted from **different languages** are typed to the **same shared
OWL concepts** (`seon:Class`, `seon:Method`, `seon:Module`), so a single query
reasons across all of them.

```bash
npm run example:polyglot
# or, from an installed tmct:
tmct chat --repo examples/polyglot
```

## What's in it

Six modules — a Java, a Python, and a C# side of the same shop domain:

| Language | Modules | Classes (all typed `seon:Class`) |
|----------|---------|----------------------------------|
| Java     | `com/shop/Order.java`, `com/shop/OrderService.java` | `Order`, `Customer`, `PremiumCustomer`, `OrderService` |
| Python   | `shop/inventory.py`, `shop/pricing.py` | `Inventory`, `Warehouse` |
| C#       | `Shop/PaymentService.cs`, `Shop/CheckoutController.cs` | `IPaymentGateway`, `PaymentService`, `CheckoutController` |

Methods (`Order.total`, `Inventory.reserve`, `PaymentService.charge`, …) are all
`seon:Method`; every file is a `seon:Module`. Inheritance
(`PremiumCustomer` ← `Customer`, `Warehouse` ← `Inventory`,
`PaymentService` ← `IPaymentGateway`) is the same `seon:hasSuperType` edge in
every language.

## Questions it can answer — across languages at once

```
how many classes          # 9 — Java + Python + C# counted as one concept
what classes are there     # lists Order (Java), Inventory (Python), PaymentService (C#), …
describe Inventory
which modules define PaymentService
which modules import Shop/PaymentService.cs
```

Because the type is the shared concept (not the syntax), "how many classes" spans
three languages in one number. That is the whole point.
