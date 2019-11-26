// --- External imports
import fetch from 'node-fetch'

// Apollo
import ApolloClient from 'apollo-client'
import { createHttpLink } from 'apollo-link-http'
import { InMemoryCache } from 'apollo-cache-inmemory'
import { setContext } from 'apollo-link-context'
import { split } from 'apollo-link'
import { WebSocketLink } from 'apollo-link-ws'
import { getMainDefinition } from 'apollo-utilities'

// --- Internal imports

export default function createGraphQLClient({ uri, wsUri, token }) {
  // console.log("createGraphQLClient", uri, wsUri, token);

  const authLink = setContext((_, { headers }) => {
    // return the headers to the context so httpLink can read them
    return {
      headers: {
        ...headers,
        authorization: token ? `Bearer ${token}` : ''
      }
    }
  })

  const httpLink = createHttpLink({ uri, fetch })

  // Now that subscriptions are managed through RabbitMQ, WebSocket transport is no longer needed
  // as it is not production-ready and causes both lost and duplicate events.
  const authHttpLink = authLink.concat(httpLink)

  let link = authHttpLink

  // Create a WebSocket link
  if (wsUri) {
    const wsLink = new WebSocketLink({
      uri: wsUri,
      options: {
        reconnect: true
      }
    })

    // using the ability to split links, you can send data to each link
    // depending on what kind of operation is being sent
    const splitLink = split(
      // split based on operation type
      ({ query }) => {
        const definition = getMainDefinition(query)
        return (
          definition.kind === 'OperationDefinition' &&
          definition.operation === 'subscription'
        )
      },
      wsLink,
      authHttpLink
    )
    link = splitLink
  }

  const client = new ApolloClient({
    link,
    cache: new InMemoryCache()
  })

  return client
}
