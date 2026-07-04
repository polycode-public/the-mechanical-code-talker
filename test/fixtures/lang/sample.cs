// Hand-written C# fixture for the bake-off (NOT wh code). Synthetic.
using System;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace Acme.Repos
{
    public enum RepoKind
    {
        Git,
        Mercurial,
        Subversion
    }

    public interface IRepoStore
    {
        Repo Get(string id);
    }

    /// <summary>A repository record.</summary>
    public class Repo
    {
        public string Id { get; set; }
        public string Name { get; set; }
    }

    public class RepoStore : IRepoStore
    {
        private class CacheEntry
        {
            public Repo Value { get; set; }
        }

        private readonly Dictionary<string, Repo> _items = new();

        /// <summary>Adds a repository to the store.</summary>
        public void Add(Repo repo)
        {
            _items[repo.Id] = repo;
        }

        public Repo Get(string id)
        {
            return _items.TryGetValue(id, out var r) ? r : null;
        }

        public async Task<Repo> LoadAsync(string id)
        {
            var raw = await ReadAsync(id);
            return new Repo { Id = id, Name = Slugify(raw) };
        }

        private static string Slugify(string name)
        {
            return name.ToLowerInvariant().Replace(" ", "-");
        }

        private Task<string> ReadAsync(string id) => Task.FromResult(id);
    }
}
