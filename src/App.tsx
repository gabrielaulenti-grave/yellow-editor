import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

interface ProjectInfo {
  path: string;
  valid: boolean;
  projectName: string;
}
interface PokemonIndexEntry {
  internalId: number;
  constant: string | null;
  displayName: string;
  kind: "pokemon" | "missingno" | "special" | "system";
  sourceSlug: string | null;
}
interface PokemonBaseStats {
  dexConstant: string;
  hp: number;
  attack: number;
  defense: number;
  speed: number;
  special: number;
  type1: string;
  type2: string;
  catchRate: number;
  baseExp: number;
}
interface LearnsetMove {
  level: number;
  moveConstant: string;
}

interface Evolution {
  method: "level" | "item" | "trade";
  level: number | null;
  item: string | null;
  target: string;
}

interface PokedexInfo {
  category: string;
  heightFeet: number;
  heightInches: number;
  weightTenthsLb: number;
  textLabel: string;
  text: string;
}

interface PokemonDetails {
  stats: PokemonBaseStats;
  evolutions: Evolution[];
  learnset: LearnsetMove[];
  pokedex: PokedexInfo | null;
}
function formatHex(value: number) {
  return `$${value
    .toString(16)
    .toUpperCase()
    .padStart(2, "0")}`;
}
type Tab = "pokemon" | "moves";

function App() {
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("pokemon");
  const [pokemonIndex, setPokemonIndex] =
  useState<PokemonIndexEntry[]>([]);
  const [status, setStatus] = useState("No project loaded.");
  const [selectedPokemonId, setSelectedPokemonId] =
  useState<number | null>(null);

  const [selectedPokemon, setSelectedPokemon] =
  useState<PokemonDetails | null>(null);

	async function loadPokemon(entry: PokemonIndexEntry) {
	  setSelectedPokemonId(entry.internalId);

	  if (!project || !entry.sourceSlug) {
		setSelectedPokemon(null);
		return;
	  }

	  try {
		const result = await invoke<PokemonDetails>(
		  "get_pokemon_details",
		  {
			projectPath: project.path,
			internalId: entry.internalId,
			sourceSlug: entry.sourceSlug,
		  }
		);

		setSelectedPokemon(result);
		setStatus("Pokémon loaded successfully.");
	  } catch (error) {
		setSelectedPokemon(null);
		setStatus(String(error));
	  }
	}
  async function selectProject() {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Select pokeyellow Project",
    });

    if (!selected) {
      return;
    }

    try {
      const result = await invoke<ProjectInfo>("open_project", {
        path: selected,
      });

      setProject(result);
      setStatus("Project loaded successfully.");

		const index = await invoke<PokemonIndexEntry[]>(
		  "get_pokemon_index",
		  {
			projectPath: result.path,
		  }
		);

		setPokemonIndex(index);


    } catch (error) {
      setProject(null);
      setStatus(String(error));
    }
  }


  return (
    <main style={{ padding: 24 }}>
      <h1>Yellow Editor</h1>

      <p>{status}</p>

      <button onClick={selectProject}>
        Open Project
      </button>

      {project && (
        <section>
          <h2>{project.projectName}</h2>
          <p>{project.path}</p>
        </section>
      )}

      <nav>
        <button onClick={() => setActiveTab("pokemon")}>
          Pokémon
        </button>

        <button onClick={() => setActiveTab("moves")}>
          Moves
        </button>
      </nav>

      {activeTab === "pokemon" && (
		  <section>
			<h2>Pokémon</h2>

			<select
			  value={selectedPokemonId ?? ""}
			  onChange={(event) => {
				const id = Number(event.target.value);

				const entry = pokemonIndex.find(
				  (pokemon) => pokemon.internalId === id
				);

				if (entry) {
				  loadPokemon(entry);
				}
			  }}
			>
			  <option value="" disabled>
				Select a Pokémon
			  </option>

			  {pokemonIndex
				.filter((entry) => entry.kind !== "system")
				.map((entry) => (
				  <option
					key={entry.internalId}
					value={entry.internalId}
				  >
					{formatHex(entry.internalId)} — {entry.displayName}
				  </option>
				))}
			</select>
			{selectedPokemon && (
			  <section>
				<h3>
				  {
					pokemonIndex.find(
					  (entry) => entry.internalId === selectedPokemonId
					)?.displayName
				  }
				</h3>

				<p>HP: {selectedPokemon.stats.hp}</p>
				<p>Attack: {selectedPokemon.stats.attack}</p>
				<p>Defense: {selectedPokemon.stats.defense}</p>
				<p>Speed: {selectedPokemon.stats.speed}</p>
				<p>Special: {selectedPokemon.stats.special}</p>

				<p>
				  Type: {selectedPokemon.stats.type1} / {selectedPokemon.stats.type2}
				</p>

				<p>Catch Rate: {selectedPokemon.stats.catchRate}</p>
				<p>Base EXP: {selectedPokemon.stats.baseExp}</p>
				
				<h4>Evolution</h4>

				{selectedPokemon.evolutions.length === 0 ? (
				  <p>Does not evolve.</p>
				) : (
				  <ul>
					{selectedPokemon.evolutions.map((evolution, index) => (
					  <li key={index}>
						{evolution.method === "level" &&
						  `Level ${evolution.level} → ${evolution.target}`}

						{evolution.method === "item" &&
						  `${evolution.item} → ${evolution.target}`}

						{evolution.method === "trade" &&
						  `Trade → ${evolution.target}`}
					  </li>
					))}
				  </ul>
				)}

				<h4>Level-up Learnset</h4>

				<table>
				  <thead>
					<tr>
					  <th>Level</th>
					  <th>Move</th>
					</tr>
				  </thead>
				  <tbody>
					{selectedPokemon.learnset.map((move, index) => (
					  <tr key={index}>
						<td>{move.level}</td>
						<td>{move.moveConstant}</td>
					  </tr>
					))}
				  </tbody>
				</table>

				<h4>Pokédex</h4>

				{selectedPokemon.pokedex ? (
				  <>
					<p>Species: {selectedPokemon.pokedex.category}</p>
					<p>
					  Height: {selectedPokemon.pokedex.heightFeet}'
					  {selectedPokemon.pokedex.heightInches}"
					</p>
					<p>
					  Weight:{" "}
					  {(selectedPokemon.pokedex.weightTenthsLb / 10).toFixed(1)} lbs
					</p>
					<p>{selectedPokemon.pokedex.text}</p>
				  </>
				) : (
				  <p>No Pokédex data.</p>
				)}
			  </section>
			)}
		  </section>
		)}

		{activeTab === "moves" && (
		  <section>
			<h2>Moves</h2>
			<p>Move editor coming soon.</p>
		  </section>
		)}
    </main>
  );

}

export default App;