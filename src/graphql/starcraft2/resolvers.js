// --- External imports

// --- Internal imports
// const { createClient } = require('../../../GraphQLClient')
import { Codes } from './enums'
require('dotenv').config()
const {
  createAgent,
  createEngine,
  createPlayer,
  taskFunctions,
  listMaps
} = require('@node-sc2/core')
const { Difficulty, Race, Status } = require('@node-sc2/core/constants/enums')

// --- Game state management
let gameState = null

const extractSimStatus = gameState => ({
  id: `sc2@${new Date().toLocaleString()}`,
  code: gameState.status,
  errors: gameState.errors
})

const newGameState = () => ({
  status: {
    id: '',
    code: Codes.Idle,
    errors: []
  }
})

const getGameState = () => {
  let state = gameState
  if (!state) {
    state = newGameState()
    setGameState({ state })
  }
  return state
}

const setGameState = ({ state }) => {
  gameState = state
  return state
}

const resetGameState = () => setGameState({ state: null })

// --- StarCraft

const getGameEngine = ({ host, port } = { host: '127.0.01', port: '5000' }) => {
  const state = getGameState()
  let engine = state.engine
  if (!engine) {
    console.log('Creating engine...')
    engine = createEngine({ host, port })
    console.log('... done!')
    state.engine = engine
  }
  return engine
}

const newBot = ({ agent, uri, token }) => {
  const client = null // createClient({ uri, token })
  return { agent, uri, token, client }
}

const run = async ({ config }) => {
  console.log('Running StarCraft II simulation...', config)

  const id = config.id || 0
  const uri =
    config.uri ||
    'https://lastknowngood.knowledge.maana.io:8443/service/b00a2def-69a1-4238-80f7-c7920aa0afd4/graphql'
  const token = config.token || ''

  const state = resetGameState()

  const agent = createAgent({
    async onGameStart({ resources }) {
      const { units, actions, map, frame } = resources.get()
      console.log('onGameStarted')
      const state = getGameState({ id })
      state.status = Status.IN_GAME
      // console.log("onGameStarted", frame.getObservation());
    },

    async onStep({ agent, resources }) {
      const { units, actions, map, frame } = resources.get()
      const { gameLoop } = frame.getObservation()

      const state = getGameState({ id })
      if (state.status === Status.IN_GAME) {
        console.log('onStep', gameLoop)
        state.gameLoop = gameLoop
        const { client } = state.bot1
        const x = await client.query({ query: GET_INFO })
        console.log('res', x)
      } else {
        console.log('onStep --- STOPPING')
      }

      // return new Promise(resolve => setTimeout(resolve, 1000));
    }
  })

  state.bot1 = newBot({ agent, uri, token })

  const engine = getGameEngine({
    host: '127.0.0.1',
    port: '5000'
  })

  try {
    console.log('Connecting...')

    state.connection = await engine.connect()
    console.log('... connected: ', state.connection)

    state.status = Status.INIT_GAME

    state.runGame = engine
      .runGame('Ladder2019Season3/AcropolisLE.SC2Map', [
        createPlayer({ race: Race.RANDOM }, state.bot1.agent),
        createPlayer({ race: Race.RANDOM, difficulty: Difficulty.MEDIUM })
      ])
      .then(rg => {
        console.log('runGame complete', rg)
        const state = getGameState({ id })
        state.status = Status.ENDED
      })
  } catch (e) {
    state.status = Status.QUIT
    state.errors = [JSON.stringify(e)]
  }
  return extractSimStatus(state)
}

const stop = async ({ id }) => {
  const state = getGameState({ id })
  state.status = Status.QUIT
  return extractSimStatus(state)
}

const simStatus = async ({ id }) => {
  const state = getGameState({ id })
  return extractSimStatus(state)
}

const observe = async ({ id }) => {
  const state = getGameState({ id })
  return { gameStatus: extractSimStatus(state) }
}

// --- GraphQL resolvers

const resolver = {
  Query: {
    listMaps: async () => (await listMaps()).map(id => ({ id })),
    simStatus: async (_, { id }) => simStatus({ id }),
    observe: async (_, { id }) => observe({ id })
  },
  Mutation: {
    run: async (_, { config }) => run({ config }),
    stop: async (_, { id }) => stop({ id })
  }
}

// --- Exports

module.exports = {
  resolver
}
