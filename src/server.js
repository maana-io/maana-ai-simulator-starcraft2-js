// --- External imports
import express from 'express'
import cors from 'cors'
import { ApolloServer } from 'apollo-server-express'
import { makeExecutableSchema } from 'graphql-tools'
import glue from 'schemaglue'
import path from 'path'
import http from 'http'

// --- Internal imports
import {
  log,
  print,
  initMetrics,
  counter,
  BuildGraphqlClient
} from 'io.maana.shared'

require('dotenv').config()

const options = {
  mode: 'js' // default
  // ignore: '**/somefileyoudonotwant.js'
}
const schemaPath = path.join(
  '.',
  `${__dirname}`.replace(process.cwd(), ''),
  'graphql/'
)
const glueRes = glue(schemaPath, options)

// Compile schema
export const schema = makeExecutableSchema({
  typeDefs: glueRes.schema,
  resolvers: glueRes.resolver
})

// --- Server setup

// Our service identity
const SELF = process.env.SERVICE_ID || 'maana-service'

// HTTP port
const PORT = process.env.PORT

// HOSTNAME for subscriptions etc.
const HOSTNAME = process.env.HOSTNAME || 'localhost'

// External DNS name for service
const PUBLICNAME = process.env.PUBLICNAME || 'localhost'

const app = express()

//
// CORS
//
const corsOptions = {
  origin: `http://${PUBLICNAME}:${PORT}`,
  credentials: true // <-- REQUIRED backend setting
}

app.use(cors(corsOptions)) // enable all CORS requests
app.options('*', cors()) // enable pre-flight for all routes

// app.get('/', (req, res) => {
//   res.send(`${SELF}\n`)
// })

const defaultSocketMiddleware = (connectionParams, webSocket) => {
  return new Promise(function(resolve, reject) {
    log(SELF).warn(
      'Socket Authentication is disabled. This should not run in production.'
    )
    resolve()
  })
}

// initMetrics(SELF.replace(/[\W_]+/g, ''))
// const graphqlRequestCounter = counter('graphqlRequests', 'it counts')

const initServer = options => {
  const { httpAuthMiddleware, socketAuthMiddleware } = options

  const socketMiddleware = socketAuthMiddleware || defaultSocketMiddleware

  const server = new ApolloServer({
    schema,
    subscriptions: {
      onConnect: socketMiddleware
    }
  })

  server.applyMiddleware({
    app,
    path: '/'
  })

  const httpServer = http.createServer(app)
  server.installSubscriptionHandlers(httpServer)

  httpServer.listen({ port: PORT }, () => {
    log(SELF).info(
      `listening on ${print.external(`http://${HOSTNAME}:${PORT}/graphql`)}`
    )
  })
}

export default initServer
