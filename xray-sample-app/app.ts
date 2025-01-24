import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import express, { Express } from 'express';

// Initialize Express app
const app: Express = express();
const PORT: number = parseInt(process.env.PORT || '8080');

app.use(express.json());

// Initialize AWS Lambda client
const lambdaClient = new LambdaClient({
  region: process.env.AWS_REGION || 'us-west-2'
});

app.get('/invoke-lambda', async (req, res) => {
  
  try {
      const command = new InvokeCommand({
        FunctionName: 'test-function-2',
        Payload: JSON.stringify({
          message: 'Hello from the caller service'
        })
      });

      const response = await lambdaClient.send(command);
      
      // Parse the Lambda response
      const payload = response.Payload ? 
        JSON.parse(Buffer.from(response.Payload).toString()) : 
        null;

      res.json({
        status: 'success',
        lambdaResponse: payload
      });
    } catch (error) {
        console.error('Error invoking Lambda:', error);
        res.status(500).json({
          status: 'error',
          message: 'Failed to invoke Lambda function'
        });
    }
});

app.listen(PORT, () => {
  console.log(`Listening for requests on http://localhost:${PORT}`);
});
