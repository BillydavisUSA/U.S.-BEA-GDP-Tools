import { proxyBeaRequest } from "../../server/bea.js";

export default (request) => proxyBeaRequest(request, Netlify.env.get("BEA_USER_ID"));
