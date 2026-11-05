# Milky Den Spin & Win

The customer website provides name/mobile registration, a prize wheel, and a
saved-result screen. It does not require OTP, email, password, or a customer
Supabase Auth account. Customer records and prizes are stored in Supabase; the
browser does not choose prizes or use localStorage to enforce eligibility.
The original logo is in `assets/logo.png`.

## Important no-OTP limitation

A mobile number entered without verification is only a claim. The website and
database cannot establish who owns it. A person who knows another customer's
number can query that number's prior prize, and could redeem/claim it in person.
The public RPCs expose no table listing or direct customer-table access, but
phone-number based lookup cannot provide identity or privacy protection. Do not
use this flow for valuable or sensitive rewards. OTP or another independent
proof of ownership is required to prevent impersonation.

The database applies per-number limits of 10 registration requests per
15-minute window and 5 spin requests per 10-minute window. These limits reduce
repeated requests for one number; they are not IP/device-wide anti-bot controls
and can be bypassed by rotating numbers. Add an edge/API gateway rate limit if
broader abuse protection is required.

## Run locally

From this folder, start a static server:

```powershell
python -m http.server 8000
```

Open <http://localhost:8000>. To open the staff interface, visit
<http://localhost:8000/admin/>.

## Supabase setup

1. If not previously applied, run
   `supabase/migrations/20261104223500_milky_den_spin_win.sql` in Supabase SQL
   Editor.
2. Run `supabase/migrations/20261104232600_customer_supabase_flow.sql` if it
   has not already been applied.
3. Then run
   `supabase/migrations/20261104234400_customer_no_otp.sql`. This migration
   replaces the OTP-required customer RPCs, adds private database rate-limit
   storage, updates the admin dashboard RPC to include registered customers
   who have not spun yet, and grants customer RPC access to the public `anon`
   role.
4. Run `supabase/migrations/20261105003000_ensure_active_campaign.sql`. It
   reuses and activates an existing `Milky Den Spin & Win` campaign or creates
   one only when there is no currently valid campaign.
5. Set the project URL and publishable/anon key in
   `assets/supabase-config.js`. Never put the service-role key in the website.
6. Add staff Auth user UUIDs to `public.admin_users` using the SQL Editor.
   Administrator accounts are not created from the website.
7. Add the website origin to the Supabase Auth URL configuration for the
   separate administrator login.

The customer flow calls `register_customer` and `spin_and_win` as an anonymous
Supabase client. The database normalizes the phone number, stores/retrieves the
customer, checks for an existing spin, selects and saves the prize, and returns
the prior result on repeat requests. A unique database index enforces one spin
per customer and campaign; a transaction-scoped advisory lock serializes spins
for the same number and campaign. No Edge Functions need deployment for this
RPC implementation.

Prize probabilities are 2% Free Softy, 3% Free Topping, 15% 20% OFF, 80% 10%
OFF, and 0% Better Luck Next Time. The 20% OFF prize requires a purchase of
₹500 or more.

## Admin panel

The staff interface continues to use Supabase Authentication and the secure
`admin_dashboard` and `admin_redeem_spin` RPCs. Existing administrator
authorization and RLS policies are not changed by the no-OTP migration.
Customers have no direct table grants; only authorized administrators can use
the dashboard to search customer and spin records or redeem prizes.
Registered customers without a spin appear with a "not spun" status and cannot
be redeemed. Customers with spins appear by spin record, including separate
records for separate campaigns.

The no-OTP RPC response is intentionally limited to the submitted number's
status and result. Since callers can submit any number, it cannot prevent
someone from looking up another person's result. This is an unavoidable
trade-off of retrieving prior results by an unverified phone number.

## Deployment status

Creating a migration file does not apply it to Supabase. Run the migrations in
the order above, configure the project URL/key, and then test registration,
repeat lookup, spin, and admin visibility against the actual Supabase project.
Existing browser-local prototype results are not imported into Supabase.
