/**
 * EDGAR company-search pages, trimmed from real responses (November 2026): a list of registrants,
 * a single company's own page (which also carries a `tableFile2` table, of its filings), and no match.
 */

export const companyListHtml = `<div id="seriesDiv" style="margin-top: 0px;">
      <table class="tableFile2" summary="Results">
         <tr>
            <th width="6%" scope="col"><acronym title="Central Index Key">CIK</acronym></th>
            <th width="79%" scope="col">Company</th>
            <th width="15%" scope="col">State/Country</th>
         </tr>
         <tr>
            <td valign="top" scope="row"><a href="/cgi-bin/browse-edgar?action=getcompany&amp;CIK=0001787724&amp;owner=include&amp;count=40&amp;hidefilings=0">0001787724</a></td>
            <td scope="row">QVC Deutschland GP, Inc.</td>
            <td valign="top" scope="row"><a href="/cgi-bin/browse-edgar?action=getcompany&amp;State=PA&amp;owner=include&amp;count=40&amp;hidefilings=0">PA</a></td>
         </tr>
         <tr class="evenRow">
            <td valign="top" scope="row"><a href="/cgi-bin/browse-edgar?action=getcompany&amp;CIK=0001355096&amp;owner=include&amp;count=40&amp;hidefilings=0">0001355096</a></td>
            <td scope="row">Old QVC Group, Inc.<br /><acronym title="Standard Industrial Code">SIC</acronym>: <a href="/cgi-bin/browse-edgar?action=getcompany&amp;SIC=5961&amp;owner=include&amp;count=40&amp;hidefilings=0">5961</a> - RETAIL-CATALOG &amp; MAIL-ORDER HOUSES<br />formerly: Liberty Interactive Corp (filings through 2018-04-09)</td>
            <td valign="top" scope="row"><a href="/cgi-bin/browse-edgar?action=getcompany&amp;State=PA&amp;owner=include&amp;count=40&amp;hidefilings=0">PA</a></td>
         </tr>
         <tr>
            <td valign="top" scope="row"><a href="/cgi-bin/browse-edgar?action=getcompany&amp;CIK=0001254699&amp;owner=include&amp;count=40&amp;hidefilings=0">0001254699</a></td>
            <td scope="row">QVC Group, Inc.<br /><acronym title="Standard Industrial Code">SIC</acronym>: <a href="/cgi-bin/browse-edgar?action=getcompany&amp;SIC=5961&amp;owner=include&amp;count=40&amp;hidefilings=0">5961</a> - RETAIL-CATALOG &amp; MAIL-ORDER HOUSES</td>
            <td valign="top" scope="row"><a href="/cgi-bin/browse-edgar?action=getcompany&amp;State=PA&amp;owner=include&amp;count=40&amp;hidefilings=0">PA</a></td>
         </tr>
      </table>
</div>`;

export const singleCompanyHtml = `<div class="companyInfo">
         <span class="companyName">Old QVC Group, Inc. <acronym title="Central Index Key">CIK</acronym>#: <a href="/cgi-bin/browse-edgar?action=getcompany&amp;CIK=0001355096&amp;owner=include&amp;count=40">0001355096 (see all company filings)</a></span>
         <p class="identInfo"><acronym title="Standard Industrial Code">SIC</acronym>: <a href="/cgi-bin/browse-edgar?action=getcompany&amp;SIC=5961&amp;owner=include&amp;count=40">5961</a> - RETAIL-CATALOG &amp; MAIL-ORDER HOUSES<br />State location: <a href="/cgi-bin/browse-edgar?action=getcompany&amp;State=PA&amp;owner=include&amp;count=40">PA</a> | Fiscal Year End: 1231<br />formerly: Liberty Interactive Corp (filings through 2018-04-09)</p>
      </div>
      <div id="seriesDiv" style="margin-top: 0px;">
      <table class="tableFile2" summary="Results">
         <tr><th scope="col">Filings</th><th scope="col">Format</th><th scope="col">Description</th><th scope="col">Filing Date</th><th scope="col">File/Film Number</th></tr>
         <tr><td nowrap="nowrap">10-Q</td><td nowrap="nowrap"><a href="/Archives/edgar/data/1355096/000135509625000042/0001355096-25-000042-index.htm" id="documentsbutton">&nbsp;Documents</a></td><td class="small">Quarterly report [Sections 13 or 15(d)]<br />Acc-no: 0001355096-25-000042&nbsp;(34 Act)&nbsp; Size: 9 MB</td><td>2025-11-06</td><td><a href="/cgi-bin/browse-edgar?action=getcompany&amp;filenum=001-33982&amp;owner=include&amp;count=40">001-33982</a><br>251457890</td></tr>
      </table>
</div>`;

export const noCompanyHtml = `<h1 style="position: relative; top: -40px;">EDGAR Company Search Results</h1>
<div class="noCompanyMatch">No matching companies.</div>`;
