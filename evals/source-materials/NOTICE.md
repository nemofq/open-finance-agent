# Third-party data notice

This directory and `evals/dataset/db.json.gz` contain third-party data used
exclusively for offline benchmark evaluation. The data is not part of the
application itself and is never loaded at runtime outside the evaluation suite.

## Data sources

| Source | Content | Files |
|---|---|---|
| **SEC EDGAR** | Public regulatory filings (10-K, 10-Q, 8-K, prospectuses), XBRL financial facts, filing indexes | `db.json.gz` (filings, financialFacts, most documents), `retail-04/` and `retail-12/` prospectus HTML/TXT |
| **Alpha Vantage** | Historical earnings and news sentiment API responses | `alpha-2024/*.json`, compiled into `db.json.gz` (alphaRecords) |
| **Yahoo Finance** | Historical daily OHLCV market bars | `market-2024/*.json`, compiled into `db.json.gz` (marketData) |
| **Reuters** | One news article excerpt (2,804 chars) | Embedded in `db.json.gz` (documents) |
| **Business Insider** | One news article excerpt (1,893 chars) | Embedded in `db.json.gz` (documents) |
| **GlobeNewsWire** | One company press release | Embedded in `db.json.gz` (documents) |
| **YieldMax** | Distribution announcement page; two 19a-1 notices referenced by URL and SHA-256 only, not shipped | `retail-04/` HTML/TXT, `retail-04/manifest.json` |

## Ownership and copyright

- **SEC EDGAR filings** are publicly available documents filed by companies with
  the U.S. Securities and Exchange Commission. The factual data within filings
  is generally not copyrightable, though the specific expression in company
  filings may remain the property of the filer.
- **Alpha Vantage** data is provided under their
  [Terms of Service](https://www.alphavantage.co/terms_of_service/).
  Alpha Vantage API data is generally licensed for personal and non-commercial
  use; bulk redistribution may require separate authorization.
- **Yahoo Finance** market data is sourced from Yahoo's internal chart API.
  Yahoo's Terms of Service generally prohibit automated access and
  redistribution. The data included here is a fixed historical snapshot used
  solely for deterministic benchmark reproducibility.
- **Reuters** and **Business Insider** article content is copyrighted by its
  respective publishers. The excerpts included are brief factual summaries used
  for benchmark grounding verification.
- **GlobeNewsWire** press releases are copyrighted by the issuing company.
- **YieldMax** materials are copyrighted by Tidal Financial Group / YieldMax.

## Purpose and use

This data exists to make the benchmark **deterministic and hermetic**: every
evaluation run sees the same captured data regardless of network availability,
API changes, or content updates. The data is not used for model training,
commercial redistribution, or any purpose beyond measuring whether code changes
improve or regress the agent's performance on fixed historical scenarios.

The project does **not** redistribute this data as a product or service. Users
who run the benchmark do so with the data already present in this repository for
the sole purpose of software evaluation.

## Disclaimer

This data is provided "as-is" for evaluation and research purposes only.
The project maintainers make no representations regarding the accuracy,
completeness, or timeliness of third-party data. Users are responsible for
ensuring their use complies with each provider's terms of service.

This project is not affiliated with, endorsed by, or sponsored by any of the
data providers listed above.

If you are a rights holder and believe any material should be removed, please
open an issue on GitHub.
