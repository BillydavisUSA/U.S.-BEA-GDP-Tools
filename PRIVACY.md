# U.S. BEA GDP Tools Privacy

Last updated: October 2, 2026

This policy describes the responsive website distributed by this repository.
The website does not require an account, ask for identity or payment details,
or include advertising, analytics, behavioral tracking, or a crash-reporting
service in its source code.

## Information used in your browser

The website processes the geographic areas, measures, and periods you select,
the public BEA records returned for those selections, and the Excel workbooks
you request. Query results are held in page memory. There is no application
database or cloud query-history feature.

Your language preference is stored in the browser's local storage so that it
can be used on later visits. Clear this website's stored browser data to remove
that preference. Closing or reloading the page discards the in-memory results.

Excel workbooks are generated in your browser and downloaded according to your
browser's download settings. They are not uploaded by the export feature.

## Network requests and hosting

The browser sends query parameters to this website's `/api/bea` endpoint. On a
Netlify deployment, a server function forwards the request to the U.S. Bureau
of Economic Analysis (BEA) at `apps.bea.gov`. The development and preview servers
also proxy this endpoint to BEA. Query selections therefore pass through the
host before BEA returns public data; they are not processed solely on your
device.

The deployment's BEA API key is supplied through the server's `BEA_USER_ID`
environment variable. It is not collected from visitors or included in the
client request parameters or exported workbooks.

The hosting provider may process standard connection information, such as IP
addresses, request URLs, timestamps, and user agents, and may retain operational
or security logs under its own policies. BEA receives the forwarded request and
connection information from the proxy. The application does not add a separate
analytics or query-history database. This policy does not claim that hosting
providers or BEA keep no logs.

External links open the linked provider's website. Those providers apply their
own policies, including [Netlify](https://www.netlify.com/privacy/) and
[BEA](https://www.bea.gov/privacy).

## Questions and changes

Questions can be raised in the
[project's GitHub issues](https://github.com/BillydavisUSA/U.S.-BEA-GDP-Tools/issues).
Do not post credentials, personal information, or private files in a public
issue. This document will be updated when the website's data-handling behavior
changes. Operators of modified deployments are responsible for describing any
additional processing they introduce.
