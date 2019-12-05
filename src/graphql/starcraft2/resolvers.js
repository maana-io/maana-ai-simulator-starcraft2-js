// --- External imports
import validUrl from 'valid-url'
import gql from 'graphql-tag'

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

const SERVICE_ID = 'maana-ai-simulator-starcraft2'

const serializeException = e =>
  Object.keys(e).length ? JSON.stringify(e) : e.toString()

// --- Simulation state management
let simulationState = null

const newSimulationState = () => ({
  config: null,
  engine: null,
  episode: 0,
  step: 0,
  agents: [],
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

const setError = error =>
  setStatus({ code: { id: Codes.Error }, errors: [error] })

const setException = exception => setError(serializeException(exception))

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

const sendOnStepMutation = async ({ client, units, step, context }) => {
  try {
    const OnStepMutation = gql`
      mutation onStep($units: [UnitAsInput!]!, $step: Int!, $context: String) {
        onStep(units: $units, step: $step, context: $context) {
          id
          action {
            id
            ability {
              id
            }
            unitTag
            targetWorldPos {
              x
              y
            }
            targetUnitTag
            queueCommand
          }
          context
        }
      }
    `

    const res = await client.mutate({
      mutation: OnStepMutation,
      variables: { units, step, context }
    })

    if (res && res.data && res.data.onStep) {
      return res.data.onStep
    }
  } catch (e) {
    console.log('Exception onStep: ', JSON.stringify(e, null, 2))
    setException(e)
  }
}

const newAgent = ({ settings, index }) => {
  let client
  let agent
  const { race, uri, token } = settings
  if (validUrl.isUri(uri)) {
    console.log('new agent', uri)
    client = createGraphQLClient({ uri, token })

    agent = createAgent({
      async onGameStart({ resources }) {
        // console.log('onGameStart', resources)
        setStatusCode(Codes.Running)

        // Initialize game state for this agent
        const state = getSimulationState()
        const agentState = state.agents[index]

        const stats = {
          score: 0.0,
          lastAction: [0.0],
          lastReward: [0.0],
          totalReward: [0.0]
        }
        agentState.stats = stats

        // const { units, actions, map, frame } = resources.get()
        // agentClient.query(OnResetMutation, ...)

        agentState.context = null // result of call to Agent
      },

      async onStep({ agent, resources }) {
        try {
          // console.log('onStep', agent, resources.get())
          const { units, map, actions, frame, debug } = resources.get()

          const qUnits = units.getAll().map(u => {
            let positions = u.pos
            if (!Array.isArray(positions)) {
              positions = [positions]
            }
            positions = positions.map(p => ({
              id: `(${p.x},${p.y})`,
              x: p.x,
              y: p.y
            }))
            return {
              id: u.tag,
              type: { id: u.unitType },
              pos: positions
            }
          })
          // console.log('units', JSON.stringify(qUnits, null, 2))

          const state = getSimulationState()

          const frameObservation = frame.getObservation()
          // console.log('frameObservation', frameObservation)

          state.step = frameObservation.gameLoop

          const agentState = state.agents[index]
          const { client, stats, context } = agentState
          const { lastReward, lastAction } = stats

          // ask the agent what action to take
          const res = await sendOnStepMutation({
            client,
            units: qUnits,
            step: state.step,
            context
          })
          // console.log('on step mutation result', res)
          if (res) {
            // store the actions and updated context
            const { action } = res
            stats.lastAction = action
            agentState.context = res.context

            // take action
            const queue = false
            const targetPos = units.getByType(317)[0].pos
            const moveTo = {
              abilityId: 16,
              unitTags: [units.getByType(48)[0].tag],
              targetWorldSpacePos: targetPos,
              //     moveTo.targetUnitTag = posOrUnit.tag;
              queueCommand: queue
            }
            // const actionResult = await actions.sendAction(moveTo)
            const scAction = {
              abilityId: parseInt(action.ability.id),
              unitTags: [action.unitTag],
              targetWorldSpacePos: {
                x: action.targetWorldPos.x,
                y: action.targetWorldPos.y
              },
              // targetUnitTag: action.targetUnitTag,
              queueCommand: action.queueCommand
            }
            const actionResult = await actions.sendAction(scAction)
            console.log('actionResult', actionResult)
            // console.log('actionResult', moveTo, scAction, actionResult)

            // Success = 1,
            // NotSupported = 2,
            // Error = 3,

            // determine reward (if any)
            stats.lastAction = [0.0]
            stats.lastReward = [0.0]
            stats.totalReward = [0.0]
          }
        } catch (e) {
          console.log('onstep exception: ', e)
        }
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

  const observation = {
    episode: state.episode,
    step: state.step,
    mode: state.config ? { id: state.config.modeId } : null,
    data: [],
    agentStats: state.agents.filter(x => !!x.stats).map(x => x.stats),
    render: '',
    status: getStatus()
  }
  // console.log('getObservation', observation)
  return observation
}

const run = async ({ config }) => {
  try {
    console.log(
      'Running StarCraft II simulation...',
      JSON.stringify(config, null, 2)
    )

    const state = resetSimulationState()

    setStatusCode(Codes.Starting)

    state.config = config

    const { environmentId, modeId, agents } = config
    // const map = environmentId
    const map = 'mini_games/MoveToBeacon.SC2Map'

    // make agent proxies for each of the specified agent settings
    state.agents = agents.map((settings, index) =>
      newAgent({ settings, index })
    )
    const validAgents = state.agents.find(a => !!a.client)
    if (!validAgents) {
      setError('Must have at least 1 valid agent URL')
    }

    // create game players, which can be agents or StarCraft's AI
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

    // get an instance of the engine
    state.engine = getEngine({
      host: '127.0.0.1',
      port: '5000'
    })

    console.log('Connecting...')
    state.connection = await state.engine.connect()
    console.log('... connected: ', state.connection)

    console.log('Running game...')
    state.runGame = state.engine.runGame(map, state.players).then(rg => {
      console.log('runGame complete', rg)
      setStatusCode(Codes.Ended)
    })
    console.log('... runGame:', state.runGame)
  } catch (e) {
    setException(e)
  }
  return getStatus()
}

const stop = () => setStatusCode(Codes.Stopped)

// --- GraphQL resolvers

const resolver = {
  Query: {
    info: async () => ({ id: SERVICE_ID, name: SERVICE_ID }),
    listEnvironments: async () => (await listMaps()).map(id => ({ id })),
    status: async () => getStatus(),
    observe: async () => getObservation()
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
