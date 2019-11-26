// --- External imports
import validUrl from 'valid-url'

// --- Internal imports
import { Codes } from './enums'
import createGraphQLClient from '../../createGraphQLClient'

require('dotenv').config()
const {
  createAgent,
  createEngine,
  createPlayer,
  // taskFunctions,
  listMaps
} = require('@node-sc2/core')
const { Difficulty, Race, Status } = require('@node-sc2/core/constants/enums')

// --- Simulation state management
let simulationState = null

const newSimulationState = () => ({
  config: null,
  engine: null,
  status: newStatus()
})

const getSimulationState = () => {
  let state = simulationState
  if (!state) {
    state = newSimulationState()
    setSimulationState({ state })
  }
  return state
}

const setSimulationState = ({ state }) => {
  simulationState = state
  return state
}

const resetSimulationState = () =>
  setSimulationState({ state: newSimulationState() })

// Safely extract last status from state
const newStatus = () => ({
  id: new Date(),
  code: { id: Codes.Unknown },
  errors: []
})

const getStatus = () => {
  const state = getSimulationState()
  let status = state.status
  if (!status) {
    status = setStatus(newStatus())
  }
  return status
}

// Construct a status object
const setStatus = status => {
  const validStatus = {
    ...newStatus(),
    ...status
  }
  const state = getSimulationState()
  state.status = validStatus
  return validStatus
}

const setStatusCode = code => setStatus({ code: { id: code } })

// --- StarCraft

const getEngine = ({ host, port } = { host: '127.0.01', port: '5000' }) => {
  const state = getSimulationState()
  let engine = state.engine
  if (!engine) {
    console.log('getEngine: creating engine...')
    engine = createEngine({ host, port })
    console.log('... engine:', state.engine)
    state.engine = engine
  }
  return engine
}

const newAgent = settings => {
  let client
  let agent
  const { race, uri, token } = settings
  if (validUrl.isUri(uri)) {
    console.log('new agent', uri)
    client = createGraphQLClient({ uri, token })

    agent = createAgent({
      async onGameStart({ resources }) {
        console.log('onGameStart', resources)
        // const { units, actions, map, frame } = resources.get()
        // agentClient.query(OnResetMutation, ...)
      },

      async onStep({ agent, resources }) {
        console.log('onStep', agent, resources)
        // const { units, actions, map, frame } = resources.get()
        // const { gameLoop } = frame.getObservation()

        const state = getSimulationState()
        state.step += 1

        // if (state.status === Status.IN_GAME) {
        //   state.gameLoop = gameLoop
        //   const { client } = state.bot1
        //   const x = await client.query({ query: GET_INFO })
        //   console.log('res', x)
        // } else {
        //   console.log('onStep --- STOPPING')
        // agentClient.query(OnStep, ...)
        // }
      }
    })
  }

  return {
    race,
    client,
    agent
  }
}

const getObservation = () => {
  const state = getSimulationState()
  let observation = state.observation
  if (!observation) {
    observation = setObservation({
      episode: 0,
      step: 0,
      data: [],
      agentStats: []
    })
  }
  return observation
}

const setObservation = observation => {
  const state = getSimulationState()
  state.observation = observation
  return observation
}

const run = async ({ config }) => {
  try {
    console.log(
      'Running StarCraft II simulation...',
      JSON.stringify(config, null, 2)
    )

    const state = resetSimulationState()
    state.config = config

    const { environmentId, modeId, agents } = config

    state.agents = agents.map(newAgent)
    const validAgents = state.agents.find(a => !!a.client)
    if (!validAgents) {
      setStatus({
        code: { id: Codes.Error },
        errors: ['Must have at least 1 valid agent URL']
      })
    }

    console.log(state.agents[0].race)

    console.log('Creating players...')
    state.players = []
    state.players[0] = createPlayer(
      {
        race: state.agents[0].race,
        difficulty: Difficulty.MEDIUM
      },
      state.agents[0].agent
    )
    state.players[1] = createPlayer(
      {
        race: state.agents[1].race,
        difficulty: Difficulty.MEDIUM
      },
      state.agents[1].agent
    )
    console.log('... players:', state.players)

    state.engine = getEngine({
      host: '127.0.0.1',
      port: '5000'
    })

    console.log('Connecting...')
    state.connection = await state.engine.connect()
    console.log('... connected: ', state.connection)

    setStatusCode(Codes.Idle)

    // const map = environmentId
    const map = 'Ladder2019Season3/AcropolisLE.SC2Map'

    console.log('Running game...')
    state.runGame = state.engine.runGame(map, state.players).then(rg => {
      console.log('runGame complete', rg)
      setStatusCode(Codes.Ended)
    })
    console.log('... runGame:', state.runGame)
    setStatusCode(Codes.Running)
  } catch (e) {
    let err = e.toString()
    if (Object.keys(e).length) {
      err = JSON.stringify(e)
    }
    console.log('run exception: ', err)
    setStatus({ code: { id: Codes.Error }, errors: [err] })
  }
  return getStatus()
}

const stop = () => setStatusCode(Codes.Stopped)

// --- GraphQL resolvers

const resolver = {
  Query: {
    listEnvironments: async () => (await listMaps()).map(id => ({ id })),
    status: async () => getStatus(),
    observe: async () => ({
      ...getObservation(),
      status: getStatus()
    })
  },
  Mutation: {
    run: async (_, { config }) => run({ config }),
    stop: async () => stop()
  }
}

// --- Exports

module.exports = {
  resolver
}
