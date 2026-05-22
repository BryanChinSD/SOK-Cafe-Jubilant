import { RequestBody } from "./route";
import axios from "axios";
import { clone } from "../common";
import { URL } from "../constants";
import { useCache } from "../../stores/cache-store";
interface Request extends Omit<RequestBody, "url"> {
  url?: string;
  loading?: boolean;
  signal?: AbortSignal; // if not null, there is a signal assigned to the request
  silent?: boolean; // if true, no toast will be shown
  info?: {
    storename?: string;
    [key: string]: any;
  };
}

export const callApi = async (request: Request) => {
  const { store } = useCache();

  const storeName = store?.store_name || request?.info?.storeName;

  const data = clone(request);
  delete data.loading;
  delete data.signal;
  delete data.silent;
  delete data.info;

  if (!data.url) data.url = URL.API;
  data.storeName = storeName;

  let token = "";
  let tokenExpires = "";
  const deviceSession = localStorage.getItem("device-session");
  if (deviceSession) {
    const session = JSON.parse(deviceSession);
    token = session?.token || "";
    tokenExpires = session?.expires || "";
  }

  const response = await axios
    .post("/api", data, {
      headers: {
        "x-token": token || "",
        "x-token-expires": tokenExpires?.toString() || "",
      },
    })
    .then((res) => res.data)
    .catch((err) => {
      console.error(err);
      return null;
    });

  return response;
};
