export const VIRGINIA_BEA_COMBINATION_AREAS = Object.freeze([
  Object.freeze({
    fips: "51901",
    name: "Albemarle County + Charlottesville city",
    beaName: "Albemarle + Charlottesville, VA",
    members: Object.freeze(["51003", "51540"]),
  }),
  Object.freeze({
    fips: "51903",
    name: "Alleghany County + Covington city",
    beaName: "Alleghany + Covington, VA",
    members: Object.freeze(["51005", "51580"]),
  }),
  Object.freeze({
    fips: "51907",
    name: "Augusta County + Staunton city + Waynesboro city",
    beaName: "Augusta, Staunton + Waynesboro, VA",
    members: Object.freeze(["51015", "51790", "51820"]),
  }),
  Object.freeze({
    fips: "51911",
    name: "Campbell County + Lynchburg city",
    beaName: "Campbell + Lynchburg, VA",
    members: Object.freeze(["51031", "51680"]),
  }),
  Object.freeze({
    fips: "51913",
    name: "Carroll County + Galax city",
    beaName: "Carroll + Galax, VA",
    members: Object.freeze(["51035", "51640"]),
  }),
  Object.freeze({
    fips: "51918",
    name: "Dinwiddie County + Colonial Heights city + Petersburg city",
    beaName: "Dinwiddie, Colonial Heights + Petersburg, VA",
    members: Object.freeze(["51053", "51570", "51730"]),
  }),
  Object.freeze({
    fips: "51919",
    name: "Fairfax County + Fairfax city + Falls Church city",
    beaName: "Fairfax, Fairfax City + Falls Church, VA",
    members: Object.freeze(["51059", "51600", "51610"]),
  }),
  Object.freeze({
    fips: "51921",
    name: "Frederick County + Winchester city",
    beaName: "Frederick + Winchester, VA",
    members: Object.freeze(["51069", "51840"]),
  }),
  Object.freeze({
    fips: "51923",
    name: "Greensville County + Emporia city",
    beaName: "Greensville + Emporia, VA",
    members: Object.freeze(["51081", "51595"]),
  }),
  Object.freeze({
    fips: "51929",
    name: "Henry County + Martinsville city",
    beaName: "Henry + Martinsville, VA",
    members: Object.freeze(["51089", "51690"]),
  }),
  Object.freeze({
    fips: "51931",
    name: "James City County + Williamsburg city",
    beaName: "James City + Williamsburg, VA",
    members: Object.freeze(["51095", "51830"]),
  }),
  Object.freeze({
    fips: "51933",
    name: "Montgomery County + Radford city",
    beaName: "Montgomery + Radford, VA",
    members: Object.freeze(["51121", "51750"]),
  }),
  Object.freeze({
    fips: "51939",
    name: "Pittsylvania County + Danville city",
    beaName: "Pittsylvania + Danville, VA",
    members: Object.freeze(["51143", "51590"]),
  }),
  Object.freeze({
    fips: "51941",
    name: "Prince George County + Hopewell city",
    beaName: "Prince George + Hopewell, VA",
    members: Object.freeze(["51149", "51670"]),
  }),
  Object.freeze({
    fips: "51942",
    name: "Prince William County + Manassas city + Manassas Park city",
    beaName: "Prince William, Manassas + Manassas Park, VA",
    members: Object.freeze(["51153", "51683", "51685"]),
  }),
  Object.freeze({
    fips: "51944",
    name: "Roanoke County + Salem city",
    beaName: "Roanoke + Salem, VA",
    members: Object.freeze(["51161", "51775"]),
  }),
  Object.freeze({
    fips: "51945",
    name: "Rockbridge County + Buena Vista city + Lexington city",
    beaName: "Rockbridge, Buena Vista + Lexington, VA",
    members: Object.freeze(["51163", "51530", "51678"]),
  }),
  Object.freeze({
    fips: "51947",
    name: "Rockingham County + Harrisonburg city",
    beaName: "Rockingham + Harrisonburg, VA",
    members: Object.freeze(["51165", "51660"]),
  }),
  Object.freeze({
    fips: "51949",
    name: "Southampton County + Franklin city",
    beaName: "Southampton + Franklin, VA",
    members: Object.freeze(["51175", "51620"]),
  }),
  Object.freeze({
    fips: "51951",
    name: "Spotsylvania County + Fredericksburg city",
    beaName: "Spotsylvania + Fredericksburg, VA",
    members: Object.freeze(["51177", "51630"]),
  }),
  Object.freeze({
    fips: "51953",
    name: "Washington County + Bristol city",
    beaName: "Washington + Bristol, VA",
    members: Object.freeze(["51191", "51520"]),
  }),
  Object.freeze({
    fips: "51955",
    name: "Wise County + Norton city",
    beaName: "Wise + Norton, VA",
    members: Object.freeze(["51195", "51720"]),
  }),
  Object.freeze({
    fips: "51958",
    name: "York County + Poquoson city",
    beaName: "York + Poquoson, VA",
    members: Object.freeze(["51199", "51735"]),
  }),
]);

export const VIRGINIA_BEA_COMBINATION_BY_FIPS = new Map(
  VIRGINIA_BEA_COMBINATION_AREAS.flatMap((area) => [
    [area.fips, area],
    ...area.members.map((member) => [member, area]),
  ]),
);

export const VIRGINIA_BEA_REPLACED_FIPS = new Set(
  VIRGINIA_BEA_COMBINATION_AREAS.flatMap((area) => area.members),
);

export function normalizeVirginiaBeaFips(fips) {
  return VIRGINIA_BEA_COMBINATION_BY_FIPS.get(String(fips))?.fips ?? String(fips);
}
