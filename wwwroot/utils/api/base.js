//import { RequestBody } from "@/app/api/route";
//import axios from "axios";
import { clone } from "../common.js";
import { URL } from "../constants.js";
import { useCache } from "../../stores/cache-store.js";
export const callApi = async (request) => {
    var _a;
    const { store } = useCache();
    const storeName = (store === null || store === void 0 ? void 0 : store.store_name) || ((_a = request === null || request === void 0 ? void 0 : request.info) === null || _a === void 0 ? void 0 : _a.storeName);
    const data = clone(request);
    delete data.loading;
    delete data.signal;
    delete data.silent;
    delete data.info;
    if (!data.url)
        data.url = URL.API;
    data.storeName = storeName;
    let token = "";
    let tokenExpires = "";
    const deviceSession = localStorage.getItem("device-session");
    if (deviceSession) {
        const session = JSON.parse(deviceSession);
        token = (session === null || session === void 0 ? void 0 : session.token) || "";
        tokenExpires = (session === null || session === void 0 ? void 0 : session.expires) || "";
    }
    const response = await axios
        .post("/api", data, {
        headers: {
            "x-token": token || "",
            "x-token-expires": (tokenExpires === null || tokenExpires === void 0 ? void 0 : tokenExpires.toString()) || "",
        },
    })
        .then((res) => res.data)
        .catch((err) => {
        console.error(err);
        return null;
    });
    return response;
};
