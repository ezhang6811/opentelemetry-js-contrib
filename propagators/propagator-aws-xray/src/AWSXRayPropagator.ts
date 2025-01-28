/*
 * Copyright The OpenTelemetry Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  trace,
  Context,
  TextMapPropagator,
  SpanContext,
  TraceFlags,
  TextMapSetter,
  TextMapGetter,
  isSpanContextValid,
  isValidSpanId,
  isValidTraceId,
  INVALID_TRACEID,
  INVALID_SPANID,
  // INVALID_SPAN_CONTEXT,
  propagation,
  Baggage,
} from '@opentelemetry/api';

export const AWSXRAY_TRACE_ID_HEADER = 'x-amzn-trace-id';

const TRACE_HEADER_DELIMITER = ';';
const KV_DELIMITER = '=';

const TRACE_ID_KEY = 'Root';
const TRACE_ID_LENGTH = 35;
const TRACE_ID_VERSION = '1';
const TRACE_ID_DELIMITER = '-';
const TRACE_ID_DELIMITER_INDEX_1 = 1;
const TRACE_ID_DELIMITER_INDEX_2 = 10;
const TRACE_ID_FIRST_PART_LENGTH = 8;

const PARENT_ID_KEY = 'Parent';

const SAMPLED_FLAG_KEY = 'Sampled';
const IS_SAMPLED = '1';
const NOT_SAMPLED = '0';

const LINEAGE_KEY = "Lineage";
const LINEAGE_DELIMITER = ":";
const LINEAGE_HASH_LENGTH = 8;
const LINEAGE_MAX_REQUEST_COUNTER = 255;
const LINEAGE_MAX_LOOP_COUNTER = 32767;

/**
 * Implementation of the AWS X-Ray Trace Header propagation protocol. See <a href=
 * https://https://docs.aws.amazon.com/xray/latest/devguide/xray-concepts.html#xray-concepts-tracingheader>AWS
 * Tracing header spec</a>
 *
 * An example AWS Xray Tracing Header is shown below:
 * X-Amzn-Trace-Id: Root=1-5759e988-bd862e3fe1be46a994272793;Parent=53995c3f42cd8ad8;Sampled=1
 */
export class AWSXRayPropagator implements TextMapPropagator {
  inject(context: Context, carrier: unknown, setter: TextMapSetter) {
    const spanContext = trace.getSpan(context)?.spanContext();
    if (!spanContext || !isSpanContextValid(spanContext)) return;

    const otTraceId = spanContext.traceId;
    const timestamp = otTraceId.substring(0, TRACE_ID_FIRST_PART_LENGTH);
    const randomNumber = otTraceId.substring(TRACE_ID_FIRST_PART_LENGTH);

    const xrayTraceId = `${TRACE_ID_VERSION}${TRACE_ID_DELIMITER}${timestamp}${TRACE_ID_DELIMITER}${randomNumber}`;

    const parentId = spanContext.spanId;
    const samplingFlag =
      (TraceFlags.SAMPLED & spanContext.traceFlags) === TraceFlags.SAMPLED
        ? IS_SAMPLED
        : NOT_SAMPLED;
    // TODO: Add OT trace state to the X-Ray trace header

    let traceHeader = `${TRACE_ID_KEY}` +
        `${KV_DELIMITER}` +
        `${xrayTraceId}` +
        `${TRACE_HEADER_DELIMITER}` +
        `${PARENT_ID_KEY}` +
        `${KV_DELIMITER}` +
        `${parentId}` +
        `${TRACE_HEADER_DELIMITER}` +
        `${SAMPLED_FLAG_KEY}` +
        `${KV_DELIMITER}` +
        `${samplingFlag}`;

    const baggage = propagation.getBaggage(context);
    const lineageV2Header = baggage?.getEntry(LINEAGE_KEY)?.value;

    if (lineageV2Header) {
      traceHeader += `${TRACE_HEADER_DELIMITER}` +
        `${LINEAGE_KEY}` +
        `${KV_DELIMITER}` +
        `${lineageV2Header}`;
    }

    setter.set(carrier, AWSXRAY_TRACE_ID_HEADER, traceHeader);
  }

  extract(context: Context, carrier: unknown, getter: TextMapGetter): Context {
    return this.getContextFromHeader(context, carrier, getter);
  }

  fields(): string[] {
    return [AWSXRAY_TRACE_ID_HEADER];
  }

  private getContextFromHeader(
    context: Context,
    carrier: unknown,
    getter: TextMapGetter
  ): Context {
    const headerKeys = getter.keys(carrier);
    const relevantHeaderKey = headerKeys.find(e => {
      return e.toLowerCase() === AWSXRAY_TRACE_ID_HEADER;
    });
    if (!relevantHeaderKey) {
      return context;
    }
    const rawTraceHeader = getter.get(carrier, relevantHeaderKey);
    const traceHeader = Array.isArray(rawTraceHeader)
      ? rawTraceHeader[0]
      : rawTraceHeader;

    if (!traceHeader || typeof traceHeader !== 'string') {
      return context;
    }

    let baggage: Baggage = propagation.getBaggage(context) || propagation.createBaggage();

    let pos = 0;
    let trimmedPart: string;
    let parsedTraceId = INVALID_TRACEID;
    let parsedSpanId = INVALID_SPANID;
    let parsedTraceFlags = null;
    while (pos < traceHeader.length) {
      const delimiterIndex = traceHeader.indexOf(TRACE_HEADER_DELIMITER, pos);
      if (delimiterIndex >= 0) {
        trimmedPart = traceHeader.substring(pos, delimiterIndex).trim();
        pos = delimiterIndex + 1;
      } else {
        //last part
        trimmedPart = traceHeader.substring(pos).trim();
        pos = traceHeader.length;
      }
      const equalsIndex = trimmedPart.indexOf(KV_DELIMITER);

      const value = trimmedPart.substring(equalsIndex + 1);

      if (trimmedPart.startsWith(TRACE_ID_KEY)) {
        parsedTraceId = AWSXRayPropagator._parseTraceId(value);
      } else if (trimmedPart.startsWith(PARENT_ID_KEY)) {
        parsedSpanId = AWSXRayPropagator._parseSpanId(value);
      } else if (trimmedPart.startsWith(SAMPLED_FLAG_KEY)) {
        parsedTraceFlags = AWSXRayPropagator._parseTraceFlag(value);
      } else if (trimmedPart.startsWith(LINEAGE_KEY)) {
        if (AWSXRayPropagator._isValidLineageV2Header(value)) {
          baggage = baggage.setEntry(LINEAGE_KEY, {value: decodeURIComponent(value)});
        }
      }
    }
    if (parsedTraceFlags === null) {
      return context;
    }
    const resultSpanContext: SpanContext = {
      traceId: parsedTraceId,
      spanId: parsedSpanId,
      traceFlags: parsedTraceFlags,
      isRemote: true,
    };
    if (isSpanContextValid(resultSpanContext)) {
      context = trace.setSpan(context, trace.wrapSpanContext(resultSpanContext));
    }
    if (baggage.getAllEntries().length > 0) {
      context = propagation.setBaggage(context, baggage);
    }

    return context;
  }

  private static _parseTraceId(xrayTraceId: string): string {
    // Check length of trace id
    if (xrayTraceId.length !== TRACE_ID_LENGTH) {
      return INVALID_TRACEID;
    }

    // Check version trace id version
    if (!xrayTraceId.startsWith(TRACE_ID_VERSION)) {
      return INVALID_TRACEID;
    }

    // Check delimiters
    if (
      xrayTraceId.charAt(TRACE_ID_DELIMITER_INDEX_1) !== TRACE_ID_DELIMITER ||
      xrayTraceId.charAt(TRACE_ID_DELIMITER_INDEX_2) !== TRACE_ID_DELIMITER
    ) {
      return INVALID_TRACEID;
    }

    const epochPart = xrayTraceId.substring(
      TRACE_ID_DELIMITER_INDEX_1 + 1,
      TRACE_ID_DELIMITER_INDEX_2
    );
    const uniquePart = xrayTraceId.substring(
      TRACE_ID_DELIMITER_INDEX_2 + 1,
      TRACE_ID_LENGTH
    );
    const resTraceId = epochPart + uniquePart;

    // Check the content of trace id
    if (!isValidTraceId(resTraceId)) {
      return INVALID_TRACEID;
    }

    return resTraceId;
  }

  private static _parseSpanId(xrayParentId: string): string {
    return isValidSpanId(xrayParentId) ? xrayParentId : INVALID_SPANID;
  }

  private static _isValidLineageV2Header(xrayLineageHeader: string): boolean {
    const lineageSubstrings = xrayLineageHeader.split(LINEAGE_DELIMITER);
    if (lineageSubstrings.length != 3) {
      return false;
    }

    const requestCounter = parseInt(lineageSubstrings[0]);
    const hashedResourceId = lineageSubstrings[1];
    const loopCounter = parseInt(lineageSubstrings[2]);
  
    const isValidKey = hashedResourceId.length == LINEAGE_HASH_LENGTH && !!hashedResourceId.match(/^[0-9a-fA-F]+$/);
    const isValidRequestCounter = requestCounter >= 0 && requestCounter <= LINEAGE_MAX_REQUEST_COUNTER;
    const isValidLoopCounter = loopCounter >= 0 && loopCounter <= LINEAGE_MAX_LOOP_COUNTER;

    return isValidKey && isValidRequestCounter && isValidLoopCounter;
  }

  private static _parseTraceFlag(xraySampledFlag: string): TraceFlags | null {
    if (xraySampledFlag === NOT_SAMPLED) {
      return TraceFlags.NONE;
    }
    if (xraySampledFlag === IS_SAMPLED) {
      return TraceFlags.SAMPLED;
    }
    return null;
  }
}
