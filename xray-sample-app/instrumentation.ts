/*instrumentation.ts*/
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { AWSXRayPropagator } from '@opentelemetry/propagator-aws-xray';

import { CompositePropagator, W3CBaggagePropagator, W3CTraceContextPropagator } from '@opentelemetry/core';

const sdk = new NodeSDK({
    serviceName: 'instrumentation-test-service',
    traceExporter: new OTLPTraceExporter(),
    textMapPropagator: new CompositePropagator({
        propagators: [
            new W3CBaggagePropagator(),
            new AWSXRayPropagator(),
            new W3CTraceContextPropagator(),
        ]
    }),
    instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();
console.log('Tracing initialized');

process.on('SIGTERM', () => {
    sdk.shutdown()
      .then(
        () => console.log('SDK shut down successfully'),
        (err) => console.log('Error shutting down SDK', err)
      )
      .finally(() => process.exit(0));
  });