import { NextRequest, NextResponse } from "next/server";
import axios from "axios";
import logger from "@/lib/logger";
import { COMP_CODE, HTTPS, ONLINE_API_URL, URL } from "@/utils/constants";
import { same } from "@/utils/common";
import dayjs from "dayjs";

export interface RequestBody {
  storeName?: string;
  url: string;
  method: string;
  api: string;
  searchparams?: Record<string, string>;
  body?: any;
}

export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get("x-token");
    const tokenExpires = Number(request.headers.get("x-token-expires"));

    if (!token || dayjs().valueOf() > tokenExpires) {
      throw new Error("Device session expired");
    }

    // Parse the JSON body from the request
    const requestBody: RequestBody = await request.json();

    // Extract the properties from the request body
    const { storeName, url, method, api, searchparams, body } = requestBody;

    if (!storeName || !url || !method || !api) {
      throw new Error("Missing required field");
    }

    if (same(url, URL.API)) {
      // Generate UUID for this request
      const uuid = crypto.randomUUID();

      const baseUrl = ONLINE_API_URL;
      if (!baseUrl) {
        throw new Error("Base URL is not set");
      }

      const compCode = COMP_CODE;
      if (!compCode) {
        throw new Error("Company code is not set");
      }

      const apiUrl = `${baseUrl}/${api}/${compCode}`;

      // Prepare axios config
      const axiosConfig = {
        method: HTTPS[method as keyof typeof HTTPS],
        url: apiUrl,
        params: searchparams,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        data:
          body && [HTTPS.POST, HTTPS.PUT].includes(method as HTTPS)
            ? { jsondata: JSON.stringify(body) }
            : undefined,
      };

      // Log API request
      const fullUrl = searchparams
        ? `${apiUrl}?${new URLSearchParams(searchparams).toString()}`
        : apiUrl;

      logger.info(`${uuid} REQUEST: [${method.toUpperCase()}] ${fullUrl}`, {
        storeName,
      });
      if (body && [HTTPS.POST, HTTPS.PUT].includes(method as HTTPS)) {
        logger.info(`${uuid} REQUEST BODY: ${JSON.stringify(body)}`, {
          storeName,
        });
      }

      const response = await axios(axiosConfig)
        .then((res) => res.data)
        .catch((err) => {
          const error = err.response.data;
          // Log API error
          logger.error(
            `${uuid} ERROR: ${
              err instanceof Error ? JSON.stringify(error) : err
            }`,
            {
              storeName,
            }
          );
          throw err;
        });

      logger.info(`${uuid} RESPONSE: ${JSON.stringify(response)}`, {
        storeName,
      });

      // For other domains, return the received data (you can add more logic here)
      return NextResponse.json(response, { status: 200 });
    } else {
      throw new Error("Invalid URL");
    }
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : error,
      },
      { status: 400 }
    );
  }
}
