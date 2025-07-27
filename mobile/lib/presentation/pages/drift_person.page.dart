import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline.widget.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';

@RoutePage()
class DriftPersonPage extends StatelessWidget {
  final DriftPerson person;

  const DriftPersonPage({super.key, required this.person});

  @override
  Widget build(BuildContext context) {
    return ProviderScope(
      overrides: [
        timelineServiceProvider.overrideWith(
          (ref) {
            final user = ref.watch(currentUserProvider);
            if (user == null) {
              throw Exception('User must be logged in to view person timeline');
            }

            final timelineService = ref.watch(timelineFactoryProvider).person(user.id, person.id);
            ref.onDispose(timelineService.dispose);
            return timelineService;
          },
        ),
      ],
      child: Timeline(
        showStorageIndicator: true,
        appBar: SliverAppBar(
          title: Text(person.name),
          floating: true,
          snap: true,
          pinned: true,
          centerTitle: true,
          elevation: 0,
        ),
      ),
    );
  }
}
