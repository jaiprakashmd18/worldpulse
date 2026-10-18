// ISO 3166-1 country dataset: alpha-2 | numeric | name | approx. latitude | approx. longitude.
// Coordinates are approximate geographic centres used only to place aggregate markers.
// Keep this list in sync with supabase/seed_countries.sql (generate it with `node scripts/generate-country-sql.mjs`).
const RAW = `AD|020|Andorra|42.5|1.6
AE|784|United Arab Emirates|23.4|53.8
AF|004|Afghanistan|33.9|67.7
AG|028|Antigua and Barbuda|17.1|-61.8
AI|660|Anguilla|18.2|-63.1
AL|008|Albania|41.2|20.2
AM|051|Armenia|40.1|45.0
AO|024|Angola|-11.2|17.9
AQ|010|Antarctica|-82.0|0.0
AR|032|Argentina|-38.4|-63.6
AS|016|American Samoa|-14.3|-170.7
AT|040|Austria|47.5|14.6
AU|036|Australia|-25.3|133.8
AW|533|Aruba|12.5|-70.0
AX|248|Åland Islands|60.2|20.0
AZ|031|Azerbaijan|40.1|47.6
BA|070|Bosnia and Herzegovina|43.9|17.7
BB|052|Barbados|13.2|-59.5
BD|050|Bangladesh|23.7|90.4
BE|056|Belgium|50.5|4.5
BF|854|Burkina Faso|12.2|-1.6
BG|100|Bulgaria|42.7|25.5
BH|048|Bahrain|26.0|50.6
BI|108|Burundi|-3.4|29.9
BJ|204|Benin|9.3|2.3
BL|652|Saint Barthélemy|17.9|-62.8
BM|060|Bermuda|32.3|-64.8
BN|096|Brunei|4.5|114.7
BO|068|Bolivia|-16.3|-63.6
BQ|535|Caribbean Netherlands|12.2|-68.3
BR|076|Brazil|-14.2|-51.9
BS|044|Bahamas|25.0|-77.4
BT|064|Bhutan|27.5|90.4
BV|074|Bouvet Island|-54.4|3.4
BW|072|Botswana|-22.3|24.7
BY|112|Belarus|53.7|28.0
BZ|084|Belize|17.2|-88.5
CA|124|Canada|56.1|-106.3
CC|166|Cocos (Keeling) Islands|-12.2|96.9
CD|180|DR Congo|-4.0|21.8
CF|140|Central African Republic|6.6|20.9
CG|178|Republic of the Congo|-0.2|15.8
CH|756|Switzerland|46.8|8.2
CI|384|Côte d'Ivoire|7.5|-5.5
CK|184|Cook Islands|-21.2|-159.8
CL|152|Chile|-35.7|-71.5
CM|120|Cameroon|7.4|12.4
CN|156|China|35.9|104.2
CO|170|Colombia|4.6|-74.3
CR|188|Costa Rica|9.7|-83.8
CU|192|Cuba|21.5|-77.8
CV|132|Cabo Verde|16.0|-24.0
CW|531|Curaçao|12.2|-69.0
CX|162|Christmas Island|-10.4|105.7
CY|196|Cyprus|35.1|33.4
CZ|203|Czechia|49.8|15.5
DE|276|Germany|51.2|10.5
DJ|262|Djibouti|11.8|42.6
DK|208|Denmark|56.3|9.5
DM|212|Dominica|15.4|-61.4
DO|214|Dominican Republic|18.7|-70.2
DZ|012|Algeria|28.0|1.7
EC|218|Ecuador|-1.8|-78.2
EE|233|Estonia|58.6|25.0
EG|818|Egypt|26.8|30.8
EH|732|Western Sahara|24.2|-12.9
ER|232|Eritrea|15.2|39.8
ES|724|Spain|40.5|-3.7
ET|231|Ethiopia|9.1|40.5
FI|246|Finland|61.9|25.7
FJ|242|Fiji|-17.7|178.1
FK|238|Falkland Islands|-51.8|-59.5
FM|583|Micronesia|7.4|150.6
FO|234|Faroe Islands|61.9|-6.9
FR|250|France|46.2|2.2
GA|266|Gabon|-0.8|11.6
GB|826|United Kingdom|54.0|-2.0
GD|308|Grenada|12.1|-61.7
GE|268|Georgia|42.3|43.4
GF|254|French Guiana|3.9|-53.1
GG|831|Guernsey|49.5|-2.6
GH|288|Ghana|7.9|-1.0
GI|292|Gibraltar|36.1|-5.4
GL|304|Greenland|71.7|-42.6
GM|270|Gambia|13.4|-15.3
GN|324|Guinea|9.9|-9.7
GP|312|Guadeloupe|16.3|-61.6
GQ|226|Equatorial Guinea|1.7|10.3
GR|300|Greece|39.1|21.8
GS|239|South Georgia and the South Sandwich Islands|-54.4|-36.6
GT|320|Guatemala|15.8|-90.2
GU|316|Guam|13.4|144.8
GW|624|Guinea-Bissau|11.8|-15.2
GY|328|Guyana|4.9|-58.9
HK|344|Hong Kong|22.3|114.2
HM|334|Heard Island and McDonald Islands|-53.1|73.5
HN|340|Honduras|15.2|-86.2
HR|191|Croatia|45.1|15.2
HT|332|Haiti|19.0|-72.3
HU|348|Hungary|47.2|19.5
ID|360|Indonesia|-0.8|113.9
IE|372|Ireland|53.4|-8.2
IL|376|Israel|31.0|34.9
IM|833|Isle of Man|54.2|-4.5
IN|356|India|20.6|79.0
IO|086|British Indian Ocean Territory|-6.3|71.9
IQ|368|Iraq|33.2|43.7
IR|364|Iran|32.4|53.7
IS|352|Iceland|65.0|-19.0
IT|380|Italy|41.9|12.6
JE|832|Jersey|49.2|-2.1
JM|388|Jamaica|18.1|-77.3
JO|400|Jordan|30.6|36.2
JP|392|Japan|36.2|138.3
KE|404|Kenya|-0.0|37.9
KG|417|Kyrgyzstan|41.2|74.8
KH|116|Cambodia|12.6|105.0
KI|296|Kiribati|1.9|-157.4
KM|174|Comoros|-11.9|43.9
KN|659|Saint Kitts and Nevis|17.4|-62.8
KP|408|North Korea|40.3|127.5
KR|410|South Korea|35.9|127.8
KW|414|Kuwait|29.3|47.5
KY|136|Cayman Islands|19.5|-80.6
KZ|398|Kazakhstan|48.0|66.9
LA|418|Laos|19.9|102.5
LB|422|Lebanon|33.9|35.9
LC|662|Saint Lucia|13.9|-61.0
LI|438|Liechtenstein|47.2|9.6
LK|144|Sri Lanka|7.9|80.8
LR|430|Liberia|6.4|-9.4
LS|426|Lesotho|-29.6|28.2
LT|440|Lithuania|55.2|23.9
LU|442|Luxembourg|49.8|6.1
LV|428|Latvia|56.9|24.6
LY|434|Libya|26.3|17.2
MA|504|Morocco|31.8|-7.1
MC|492|Monaco|43.7|7.4
MD|498|Moldova|47.4|28.4
ME|499|Montenegro|42.7|19.4
MF|663|Saint Martin|18.1|-63.1
MG|450|Madagascar|-18.8|46.9
MH|584|Marshall Islands|7.1|171.2
MK|807|North Macedonia|41.6|21.7
ML|466|Mali|17.6|-4.0
MM|104|Myanmar|21.9|95.9
MN|496|Mongolia|46.9|103.8
MO|446|Macao|22.2|113.5
MP|580|Northern Mariana Islands|15.1|145.7
MQ|474|Martinique|14.6|-61.0
MR|478|Mauritania|21.0|-10.9
MS|500|Montserrat|16.7|-62.2
MT|470|Malta|35.9|14.4
MU|480|Mauritius|-20.3|57.6
MV|462|Maldives|3.2|73.2
MW|454|Malawi|-13.3|34.3
MX|484|Mexico|23.6|-102.6
MY|458|Malaysia|4.2|102.0
MZ|508|Mozambique|-18.7|35.5
NA|516|Namibia|-22.6|17.1
NC|540|New Caledonia|-20.9|165.6
NE|562|Niger|17.6|8.1
NF|574|Norfolk Island|-29.0|167.9
NG|566|Nigeria|9.1|8.7
NI|558|Nicaragua|12.9|-85.2
NL|528|Netherlands|52.1|5.3
NO|578|Norway|60.5|8.5
NP|524|Nepal|28.4|84.1
NR|520|Nauru|-0.5|166.9
NU|570|Niue|-19.1|-169.9
NZ|554|New Zealand|-40.9|174.9
OM|512|Oman|21.5|55.9
PA|591|Panama|8.5|-80.8
PE|604|Peru|-9.2|-75.0
PF|258|French Polynesia|-17.7|-149.4
PG|598|Papua New Guinea|-6.3|143.9
PH|608|Philippines|12.9|121.8
PK|586|Pakistan|30.4|69.3
PL|616|Poland|51.9|19.1
PM|666|Saint Pierre and Miquelon|46.9|-56.3
PN|612|Pitcairn Islands|-24.7|-127.4
PR|630|Puerto Rico|18.2|-66.6
PS|275|Palestine|31.9|35.2
PT|620|Portugal|39.4|-8.2
PW|585|Palau|7.5|134.6
PY|600|Paraguay|-23.4|-58.4
QA|634|Qatar|25.4|51.2
RE|638|Réunion|-21.1|55.5
RO|642|Romania|45.9|25.0
RS|688|Serbia|44.0|21.0
RU|643|Russia|61.5|105.3
RW|646|Rwanda|-1.9|29.9
SA|682|Saudi Arabia|23.9|45.1
SB|090|Solomon Islands|-9.6|160.2
SC|690|Seychelles|-4.7|55.5
SD|729|Sudan|12.9|30.2
SE|752|Sweden|60.1|18.6
SG|702|Singapore|1.4|103.8
SH|654|Saint Helena, Ascension and Tristan da Cunha|-15.9|-5.7
SI|705|Slovenia|46.2|15.0
SJ|744|Svalbard and Jan Mayen|78.0|16.0
SK|703|Slovakia|48.7|19.7
SL|694|Sierra Leone|8.5|-11.8
SM|674|San Marino|43.9|12.5
SN|686|Senegal|14.5|-14.5
SO|706|Somalia|5.2|46.2
SR|740|Suriname|3.9|-56.0
SS|728|South Sudan|6.9|31.3
ST|678|São Tomé and Príncipe|0.2|6.6
SV|222|El Salvador|13.8|-88.9
SX|534|Sint Maarten|18.0|-63.1
SY|760|Syria|34.8|39.0
SZ|748|Eswatini|-26.5|31.5
TC|796|Turks and Caicos Islands|21.7|-71.8
TD|148|Chad|15.5|18.7
TF|260|French Southern Territories|-49.3|69.3
TG|768|Togo|8.6|0.8
TH|764|Thailand|15.9|101.0
TJ|762|Tajikistan|38.9|71.3
TK|772|Tokelau|-9.2|-171.8
TL|626|Timor-Leste|-8.9|125.7
TM|795|Turkmenistan|39.0|59.6
TN|788|Tunisia|33.9|9.5
TO|776|Tonga|-21.2|-175.2
TR|792|Türkiye|39.0|35.2
TT|780|Trinidad and Tobago|10.7|-61.2
TV|798|Tuvalu|-7.1|177.6
TW|158|Taiwan|23.7|121.0
TZ|834|Tanzania|-6.4|34.9
UA|804|Ukraine|48.4|31.2
UG|800|Uganda|1.4|32.3
UM|581|U.S. Minor Outlying Islands|19.3|166.6
US|840|United States|39.8|-98.6
UY|858|Uruguay|-32.5|-55.8
UZ|860|Uzbekistan|41.4|64.6
VA|336|Vatican City|41.9|12.5
VC|670|Saint Vincent and the Grenadines|13.3|-61.2
VE|862|Venezuela|6.4|-66.6
VG|092|British Virgin Islands|18.4|-64.6
VI|850|U.S. Virgin Islands|18.3|-64.9
VN|704|Vietnam|14.1|108.3
VU|548|Vanuatu|-15.4|166.9
WF|876|Wallis and Futuna|-13.8|-177.2
WS|882|Samoa|-13.8|-172.1
XK||Kosovo|42.6|20.9
YE|887|Yemen|15.6|48.5
YT|175|Mayotte|-12.8|45.2
ZA|710|South Africa|-30.6|22.9
ZM|894|Zambia|-13.1|27.8
ZW|716|Zimbabwe|-19.0|29.2`;

export const COUNTRIES = RAW.split('\n').map((line) => {
  const [code, numeric, name, lat, lon] = line.split('|');
  return { code, numeric, name, lat: Number(lat), lon: Number(lon) };
});

export const COUNTRY_BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c]));
export const COUNTRY_BY_NUMERIC = new Map(COUNTRIES.filter((c) => c.numeric).map((c) => [c.numeric, c]));

// Features in the world-atlas TopoJSON that carry no ISO numeric id.
export const ATLAS_NAME_FALLBACK = { Kosovo: 'XK', 'N. Cyprus': 'CY', Somaliland: 'SO' };

/** Regional-indicator emoji flag for an ISO alpha-2 code. */
export function flagEmoji(code) {
  if (!/^[A-Z]{2}$/.test(code)) return '🏳️';
  return String.fromCodePoint(...[...code].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
}
