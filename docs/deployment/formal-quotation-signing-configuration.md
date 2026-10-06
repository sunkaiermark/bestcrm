# Formal quotation signing: production configuration

The formal quotation workflow is fail-closed. Installing the release does not authorize a quotation to be issued. Before live use, publish the approved wording for each of the eight commercial-term sections in each required language, and provide approved seller details for both legal entities.

Set these environment variables on the server (not in Git):

- `QUOTATION_SELLER_PROFILES_FILE`: absolute path to a private JSON file. Its top-level keys are `sunkaier_china` and `sunkaier_apac`. Each entry contains the company's approved `address`, `phone`, and HTTPS `website`. The legal names and `sales@sunkaier.com` are fixed in CRM code. Missing values block formal submission.
- `QUOTATION_MARK_SIGNATURE_FILE`: absolute path to Mark Yang's approved PNG, placed directly in `$UPLOAD_DIR/quotation-signing-assets/`.
- `QUOTATION_APAC_SEAL_FILE`: absolute path to SUNKAIER ASIA PACIFIC PTE. LTD.'s approved PNG in that same private directory. It is required only when this seller is selected. The Jiangsu seller intentionally has no company seal configured and may be issued with the personal signature alone.

The signing images must be private regular files, readable only by the CRM service account and administrators. Do not put them under the public `src/public/assets` directory, into the release ZIP, or into Git. The service records the image hashes at signing and saves the signed A4 PDF under private uploads. The signed PDF is downloaded through an authenticated, opportunity-scoped route and is checked against its stored SHA-256 and length before email attachment.

The Mark Yang PNG supplied for this change has SHA-256 `D9EC7EAFDB83FF28C3E896E7ED59E66C1C57C7B95E8B7CEBE61D7AF7A2A9D7EE`. The Singapore company seal PNG has SHA-256 `FCE6C3E0D9AD432D9FBBC4FE12E544FEB299614D25970BB17D07E6B7736CDDE3`. Verify the exact private files after copying them; never substitute another company's seal. Confirm that the CRM username is exactly `MarkYang`, the account is active, and the assigned commercial manager is a different account from the submitting salesperson.

Approval does not issue a PDF. Only the active `MarkYang` account can click the issue action after approval. This is a CRM-authorized image signature, **not** a third-party qualified digital signature. If the technical source changes or a newer technical revision exists, prepare and approve a new formal quotation version before sending.
